import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

function getAuthUser(req) {
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const uname = String(username).trim();
  const pwd = String(password);

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const userKey = `user:${uname}`;
  const existing = await redis.get(userKey);
  if (!existing) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
  const ok = await bcrypt.compare(pwd, parsed.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = jwt.sign({ sub: uname }, process.env.JWT_SECRET, { expiresIn: '2h' });
  return res.status(200).json({ ok: true, token });
}

