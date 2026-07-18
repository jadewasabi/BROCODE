import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

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

  if (uname.length < 3 || uname.length > 24) {
    return res.status(400).json({ error: 'username must be 3-24 characters' });
  }
  if (pwd.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const userKey = `user:${uname}`;
  const existing = await redis.get(userKey);
  if (existing) {
    return res.status(409).json({ error: 'username already exists' });
  }

  const passwordHash = await bcrypt.hash(pwd, 12);
  await redis.set(userKey, JSON.stringify({ username: uname, passwordHash }));

  // Create a token immediately (optional, but convenient)
  const token = jwt.sign({ sub: uname }, process.env.JWT_SECRET, { expiresIn: '2h' });

  return res.status(200).json({ ok: true, token });
}

