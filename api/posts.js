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

function makeId(n) {
  return String(n);
}

export default async function handler(req, res) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  if (req.method === 'GET') {
    // NOTE: Some Redis providers / configurations may not persist the list key as expected.
    // To guarantee correctness, we fetch the recent post ids from a Redis set.
    // This requires POST to also maintain that set.

    // primary: ordered list
    const ids = await redis.lrange('posts', 0, 49);

    // fallback: set-based last-ids
    let effectiveIds = Array.isArray(ids) ? ids : [];

    if (!effectiveIds.length) {
      const setIds = await redis.smembers('posts:id');
      // Keep deterministic ordering by sorting numerically descending.
      effectiveIds = (Array.isArray(setIds) ? setIds : [])
        .slice()
        .map(String)
        .sort((a, b) => Number(b) - Number(a))
        .slice(0, 50);
    }

    const posts = [];
    for (const id of effectiveIds) {
      const raw = await redis.get(`post:${id}`);
      if (!raw) continue;
      try {
        posts.push(JSON.parse(raw));
      } catch {
        // ignore
      }
    }

    return res.status(200).json({
      posts,
      env: {
        hasRedisUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
        hasRedisToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
        jwtSecretSet: Boolean(process.env.JWT_SECRET),
      },
    });
  }

  if (req.method === 'POST') {
    const user = authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { text, imageUrl } = req.body || {};
    const t = typeof text === 'string' ? text.trim() : '';
    const img = typeof imageUrl === 'string' ? imageUrl.trim() : '';

    if (!t && !img) return res.status(400).json({ error: 'text or imageUrl required' });
    if (t.length > 2000) return res.status(400).json({ error: 'text too long' });

    const id = await redis.incr('post:id');
    const post = {
      id: makeId(id),
      username: user,
      text: t || null,
      imageUrl: img || null,
      createdAt: Math.floor(Date.now() / 1000),
      reactions: { likes: 0, loves: 0 },
      comments: [],
    };

    await redis.set(`post:${post.id}`, JSON.stringify(post));

    // Maintain list + set for robust reads.
    await redis.lpush('posts', post.id);
    await redis.ltrim('posts', 0, 99);

    await redis.sadd('posts:id', post.id);

    return res.status(201).json({ post });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

