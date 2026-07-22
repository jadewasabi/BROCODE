import { Redis } from '@upstash/redis';
import jwt from 'jsonwebtoken';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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

function getConversationId(user1, user2) {
  // Sort names to ensure consistent key regardless of who initiates
  const sorted = [user1, user2].sort();
  return `conv:${sorted[0]}:${sorted[1]}`;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  // ======== GET: List conversations for the authenticated user ========
  if (req.method === 'GET') {
    try {
      // Get all conversation IDs for this user
      const rawConvs = await redis.smembers(`user:convs:${user}`);
      const convIds = Array.isArray(rawConvs) ? rawConvs : [];

      // Fetch preview data (last message) for each conversation in parallel
      const previews = await Promise.all(
        convIds.map(async (convId) => {
          const raw = await redis.lindex(`msgs:${convId}`, 0);
          let lastMsg = null;
          if (raw) {
            try { lastMsg = typeof raw === 'string' ? JSON.parse(raw) : raw; }
            catch { lastMsg = null; }
          }

          // Extract the other user from the conversation key
          const parts = convId.split(':');
          // conv:user1:user2 → parts[1] = user1, parts[2] = user2
          const otherUser = parts[1] === user ? parts[2] : parts[1];

          return {
            conversationId: convId,
            withUser: otherUser,
            lastMessage: lastMsg,
            lastActivity: lastMsg?.createdAt || 0,
          };
        })
      );

      // Sort by most recent activity first
      previews.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json({ conversations: previews });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load conversations' });
    }
  }

  // ======== POST: Send a new message (or create conversation) ========
  if (req.method === 'POST') {
    const { to, text } = req.body || {};
    const recipient = String(to || '').trim();
    const messageText = typeof text === 'string' ? text.trim() : '';

    if (!recipient) return res.status(400).json({ error: 'recipient (to) required' });
    if (!messageText) return res.status(400).json({ error: 'text required' });
    if (messageText.length > 2000) return res.status(400).json({ error: 'text too long' });
    if (recipient === user) return res.status(400).json({ error: 'Cannot message yourself' });

    // Check if recipient exists
    const recipientExists = await redis.get(`user:${recipient}`);
    if (!recipientExists) return res.status(404).json({ error: 'User not found' });

    const convId = getConversationId(user, recipient);
    const now = Math.floor(Date.now() / 1000);
    const msgId = await redis.incr('msg:id');

    const message = {
      id: String(msgId),
      from: user,
      to: recipient,
      text: messageText,
      createdAt: now,
    };

    // Store message in the conversation's list
    await redis.lpush(`msgs:${convId}`, JSON.stringify(message));
    // Trim to keep last 200 messages
    await redis.ltrim(`msgs:${convId}`, 0, 199);

    // Index this conversation for both users
    await redis.sadd(`user:convs:${user}`, convId);
    await redis.sadd(`user:convs:${recipient}`, convId);

    return res.status(201).json({ ok: true, message });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
