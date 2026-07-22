import { Redis } from '@upstash/redis';
import jwt from 'jsonwebtoken';

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
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  // Extract post ID from URL path: /api/posts/{id}/comment
  const id = String(req.query.id || req.body?.postId || '').trim();
  if (!id) return res.status(400).json({ error: 'postId required' });

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  if (req.method === 'GET') {
    // Fetch comments for a post
    const commentLimit = Math.min(50, parseInt(req.query.limit) || 10);
    const rawComments = await redis.lrange(`post:comments:${id}`, 0, commentLimit - 1);
    const comments = (rawComments || []).map(c => {
      try { return typeof c === 'string' ? JSON.parse(c) : c; }
      catch { return null; }
    }).filter(Boolean);

    res.setHeader('Cache-Control', 'public, max-age=2, s-maxage=5, stale-while-revalidate=15');
    return res.status(200).json({ comments, postId: id });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const t = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

  if (!t) return res.status(400).json({ error: 'text required' });
  if (t.length > 300) return res.status(400).json({ error: 'text too long' });

  // Verify post exists
  const raw = await redis.get(`post:${id}`);
  if (!raw) return res.status(404).json({ error: 'post not found' });

  // Store comment in a Redis List: post:comments:{id}
  // This avoids rewriting the entire post object on every comment
  const comment = { username: user, text: t, createdAt: Math.floor(Date.now() / 1000) };
  await redis.lpush(`post:comments:${id}`, JSON.stringify(comment));
  // Trim to keep only last 50 comments
  await redis.ltrim(`post:comments:${id}`, 0, 49);

  return res.status(200).json({ ok: true, comment });
}
