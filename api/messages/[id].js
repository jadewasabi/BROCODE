import { Redis } from '@upstash/redis';
import jwt from 'jsonwebtoken';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function authUser(req) {
  const header = req.headers?.authorization || '';
  const parts = String(header).split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  try {
    const payload = jwt.verify(parts[1], process.env.JWT_SECRET);
    return payload?.sub || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  // The conversation ID is passed as a query parameter: convId
  const convId = String(req.query.convId || req.body?.convId || '').trim();
  if (!convId) return res.status(400).json({ error: 'convId required' });

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Verify user is part of this conversation
  const isMember = await redis.sismember(`user:convs:${user}`, convId);
  if (!isMember) return res.status(403).json({ error: 'Not a participant in this conversation' });

  // ======== GET: Fetch messages in a conversation (paginated) ========
  if (req.method === 'GET') {
    try {
      const limit = Math.min(100, parseInt(req.query.limit) || 50);
      const offset = parseInt(req.query.offset) || 0;

      const rawMsgs = await redis.lrange(`msgs:${convId}`, offset, offset + limit - 1);
      const messages = (rawMsgs || []).map(m => {
        try { return typeof m === 'string' ? JSON.parse(m) : m; }
        catch { return null; }
      }).filter(Boolean);

      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json({ messages, convId });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load messages' });
    }
  }

  // ======== DELETE: Unsend a message ========
  if (req.method === 'DELETE') {
    const msgId = String(req.query.msgId || req.body?.msgId || '').trim();
    if (!msgId) return res.status(400).json({ error: 'msgId required' });

    try {
      // Get all messages in the conversation
      const rawMsgs = await redis.lrange(`msgs:${convId}`, 0, -1);
      const parsed = rawMsgs.map((m, idx) => {
        try { return { idx, data: typeof m === 'string' ? JSON.parse(m) : m }; }
        catch { return null; }
      }).filter(Boolean);

      // Find the message with matching ID
      const target = parsed.find(item => item.data.id === msgId);
      if (!target) return res.status(404).json({ error: 'Message not found' });
      if (target.data.from !== user) return res.status(403).json({ error: 'Can only unsend your own messages' });

      // Replace the message with an "unsent" marker (keep position in list)
      const unsentMsg = {
        id: msgId,
        from: user,
        unsent: true,
        createdAt: target.data.createdAt,
      };

      // Rebuild the list with the unsent marker
      const updated = rawMsgs.map((m, idx) => {
        if (idx === target.idx) return JSON.stringify(unsentMsg);
        return m;
      });

      // Delete and re-push all messages
      await redis.del(`msgs:${convId}`);
      if (updated.length > 0) {
        // Push in reverse to maintain order (since we use LPUSH normally)
        for (const msg of updated.reverse()) {
          await redis.lpush(`msgs:${convId}`, msg);
        }
      }

      return res.status(200).json({ ok: true, message: { ...unsentMsg } });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to unsend message' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
