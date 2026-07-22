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
  res.setHeader('Access-Control-Allow-Methods', 'DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'postId required' });

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const raw = await redis.get(`post:${id}`);
  if (!raw) return res.status(404).json({ error: 'post not found' });

  const post = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Only the post author can delete
  if (post.username !== user) {
    return res.status(403).json({ error: 'You can only delete your own posts' });
  }

  // Delete the post data, remove from index sets, and clean up reaction sets
  await redis.del(`post:${id}`);
  await redis.srem('posts:id', id);
  await redis.zrem('posts:bytime', id);
  await redis.zrem('posts:upvoted', id);
  await redis.del(`post:comments:${id}`);
  await redis.del(`post:${id}:react:like`);
  await redis.del(`post:${id}:react:love`);
  await redis.del(`post:${id}:react:upvote`);

  return res.status(200).json({ ok: true });
}
