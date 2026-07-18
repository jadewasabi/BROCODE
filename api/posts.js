import { Redis } from '@upstash/redis';
import jwt from 'jsonwebtoken';

// DEBUG: add request-id style logs (visible in Vercel function logs)
function redact(s) {
  if (!s) return '';
  return String(s).slice(0, 4) + '...';
}


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

function makeId(n) {
  return String(n);
}

export default async function handler(req, res) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  if (req.method === 'GET') {
    // Stored as a list: posts (newest first)
    // Each post stored under post:{id}
    const ids = await redis.lrange('posts', 0, 49); // newest up to 50

    console.log('posts GET list length:', Array.isArray(ids) ? ids.length : 'not-array');
    if (Array.isArray(ids)) console.log('posts GET ids sample:', ids.slice(0, 5));

    const posts = [];

    for (const id of ids) {
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
    await redis.lpush('posts', post.id);
    await redis.ltrim('posts', 0, 99);

    return res.status(201).json({ post });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

