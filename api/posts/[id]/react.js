import { Redis } from '@upstash/redis';
import jwt from 'jsonwebtoken';

function authUser(req) {
  const header = req.headers?.authorization || '';
  const parts = String(header).split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  try {
    const payload = jwt.verify(parts[1], process.env.JWT_SECRET);
    return payload?.sub || null;
  } catch (_) {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  // Extract post ID from URL path: /api/posts/{id}/react
  // On Vercel, dynamic segments are passed as req.query.id
  const id = String(req.query.id || req.body?.postId || '').trim();
  const r = String(req.body?.reaction || '').trim();

  if (!id) return res.status(400).json({ error: 'postId required' });
  if (r !== 'like' && r !== 'love' && r !== 'upvote') return res.status(400).json({ error: 'reaction must be like, love, or upvote' });

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const raw = await redis.get(`post:${id}`);
  if (!raw) return res.status(404).json({ error: 'post not found' });
  const post = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Per-user toggles using sets
  // Handle upvote: bump post to top of timeline by updating createdAt
  if (r === 'upvote') {
    post.createdAt = Math.floor(Date.now() / 1000);
    await redis.set(`post:${id}`, JSON.stringify(post));
    return res.status(200).json({ ok: true, post });
  }

  const setKey = `post:${id}:react:${r}`;
  const already = await redis.sismember(setKey, user);
  if (already) {
    // remove reaction
    await redis.srem(setKey, user);
    if (r === 'like') post.reactions.likes = Math.max(0, (post.reactions.likes || 0) - 1);
    if (r === 'love') post.reactions.loves = Math.max(0, (post.reactions.loves || 0) - 1);
  } else {
    await redis.sadd(setKey, user);
    if (r === 'like') post.reactions.likes = (post.reactions.likes || 0) + 1;
    if (r === 'love') post.reactions.loves = (post.reactions.loves || 0) + 1;
  }

  await redis.set(`post:${id}`, JSON.stringify(post));
  return res.status(200).json({ ok: true, post });
}
