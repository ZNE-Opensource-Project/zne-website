import Redis from 'ioredis';

const SECRET = process.env.COMMANDS_SECRET;
const REDIS_URL = process.env.REDIS_URL;

let redis = null;

function getRedis() {
  if (!redis && REDIS_URL) {
    redis = new Redis(REDIS_URL);
  }
  return redis;
}

function isRedisConfigured() {
  return !!REDIS_URL;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!isRedisConfigured()) {
    const msg = 'REDIS_URL is not configured. Make sure your Redis database is connected and REDIS_URL env var is set, then redeploy.';
    console.error(msg);
    return res.status(500).json({ error: msg });
  }

  // ==================== GET ====================
  if (req.method === 'GET') {
    try {
      const raw = await getRedis().get('zne-commands');

      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.commands)) {
          return res.status(200).json(data);
        }
      }

      return res.status(200).json({ commands: [] });
    } catch (error) {
      console.error('Redis GET error:', error);
      return res.status(500).json({
        error: 'Failed to fetch commands from Redis',
        details: error?.message || String(error)
      });
    }
  }

  // ==================== POST (from bot) ====================
  if (req.method === 'POST') {
    const { commands, secret } = req.body || {};

    if (!SECRET || secret !== SECRET) {
      return res.status(401).json({ error: 'Unauthorized: Invalid secret key' });
    }

    if (!Array.isArray(commands)) {
      return res.status(400).json({ error: 'Bad Request: "commands" must be an array' });
    }

    try {
      await getRedis().set('zne-commands', JSON.stringify({ commands }));

      return res.status(200).json({
        success: true,
        message: 'Command list updated successfully',
        count: commands.length
      });
    } catch (error) {
      console.error('Redis SET error:', error);
      return res.status(500).json({
        error: 'Failed to save commands to Redis',
        details: error?.message || String(error)
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
