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

function makeId(n) {
  return String(n);
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  if (req.method === 'GET') {
    // --- Pagination ---
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 15));
    const offset = (page - 1) * limit;

    // --- TWO-TIER RANKING ---
    // Tier 1: Upvoted posts (sorted by upvote time, newest first)
    // Tier 2: Non-upvoted posts (sorted by creation time, newest first)
    // Upvoted posts ALWAYS stay above non-upvoted posts
    
    let upvotedIds = [];
    let regularIds = [];

    try {
      upvotedIds = await redis.zrevrange('posts:upvoted', 0, -1);
    } catch { /* ignore */ }

    try {
      regularIds = await redis.zrevrange('posts:bytime', 0, -1);
    } catch { /* ignore */ }

    // Fallback to old set if sorted sets are empty (migration)
    if (!regularIds || regularIds.length === 0) {
      const setIds = await redis.smembers('posts:id');
      regularIds = (setIds || []).map(String).sort((a, b) => Number(b) - Number(a));
    }

    // Remove upvoted IDs from regular IDs (they appear in Tier 1)
    const upvotedSet = new Set(upvotedIds.map(String));
    regularIds = regularIds.filter(id => !upvotedSet.has(String(id)));

    // Combine: upvoted first, then regular
    const allOrderedIds = [...upvotedIds, ...regularIds];
    const total = allOrderedIds.length;
    const pageIds = allOrderedIds.slice(offset, offset + limit);

    // --- Single mget() call instead of N individual redis.get() calls ---
    const keys = pageIds.map(id => `post:${id}`);
    const rawPosts = keys.length > 0 ? await redis.mget(...keys) : [];

    const posts = [];
    for (let i = 0; i < pageIds.length; i++) {
      const raw = rawPosts[i];
      if (!raw) continue;
      try {
        const post = typeof raw === 'string' ? JSON.parse(raw) : raw;
        // Strip embedded comments from response — they load separately now
        const { comments, ...postData } = post;
        const cleaned = { 
          ...postData, 
          commentCount: Array.isArray(comments) ? comments.length : 0,
          isUpvoted: postData.upvotedAt ? true : false 
        };
        posts.push(cleaned);
      } catch { /* skip corrupt posts */ }
    }

    // Re-sort to match the combined order
    const postMap = new Map(posts.map(p => [String(p.id), p]));
    const orderedPosts = pageIds.map(id => postMap.get(String(id))).filter(Boolean);

    // --- Cache hint for CDN / browser ---
    res.setHeader('Cache-Control', 'public, max-age=3, s-maxage=10, stale-while-revalidate=30');

    return res.status(200).json({
      posts: orderedPosts,
      total,
      page,
      limit,
      hasMore: offset + limit < total,
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
    const postId = makeId(id);
    const now = Math.floor(Date.now() / 1000);

    const post = {
      id: postId,
      username: user,
      text: t || null,
      imageUrl: img || null,
      createdAt: now,
      reactions: { likes: 0, loves: 0 },
      // comments no longer stored inline — use post:comments:{id} list
    };

    await redis.set(`post:${postId}`, JSON.stringify(post));
    // Add to sorted set for fast timeline ordering (score = createdAt)
    await redis.zadd('posts:bytime', { score: now, member: postId });
    // Keep backward compat with old set
    await redis.sadd('posts:id', postId);

    return res.status(201).json({ post });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

