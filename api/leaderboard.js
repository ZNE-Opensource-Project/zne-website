import Redis from 'ioredis';

const LEADERBOARD_SECRET = process.env.LEADERBOARD_SECRET || process.env.API_SECRET || process.env.COMMANDS_SECRET;
const REDIS_URL = process.env.REDIS_URL;
const LEADERBOARD_KEY = 'zne-leaderboard';

let redis = null;
let memoryLeaderboard = {
  global_total_commands: 0,
  updated_at: null,
  users: []
};

function getRedis() {
  if (!redis && REDIS_URL) {
    redis = new Redis(REDIS_URL);
  }
  return redis;
}

function isRedisConfigured() {
  return !!REDIS_URL;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function getRequestSecret(req, body) {
  const auth = req.headers?.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  return String(body.secret || '').trim() || String(req.headers?.['x-api-secret'] || '').trim() || '';
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function normalizeCommandCounts(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }

  const ignored = new Set([
    'userid',
    'user_id',
    'id',
    'username',
    'display_name',
    'avatar',
    'avatar_url',
    'total_commands',
    'totalCommands',
    'rank',
    'commands'
  ]);

  const commands = {};
  Object.entries(source).forEach(([name, count]) => {
    if (ignored.has(name)) return;
    const value = toNumber(count, 0);
    if (value > 0) commands[name] = value;
  });

  return commands;
}

function normalizeUser(rawUser) {
  if (!rawUser || typeof rawUser !== 'object' || Array.isArray(rawUser)) {
    return null;
  }

  const userId = rawUser.userid || rawUser.user_id || rawUser.id;
  if (!userId) return null;

  const commandCounts = rawUser.commands || rawUser.command_counts || rawUser;
  const commands = normalizeCommandCounts(commandCounts);
  const totalCommands = toNumber(rawUser.total_commands ?? rawUser.totalCommands, Object.values(commands).reduce((sum, count) => sum + count, 0));

  return {
    userid: String(userId),
    username: rawUser.username || rawUser.name || String(userId),
    display_name: rawUser.display_name || rawUser.displayName || rawUser.username || rawUser.name || String(userId),
    avatar_url: rawUser.avatar_url || rawUser.avatar || '',
    total_commands: totalCommands,
    commands
  };
}

function normalizeLeaderboard(payload) {
  const sourceUsers = Array.isArray(payload) ? payload : payload.users;
  const users = [];

  if (Array.isArray(sourceUsers)) {
    sourceUsers.forEach(user => {
      const normalized = normalizeUser(user);
      if (normalized) users.push(normalized);
    });
  }

  users.sort((a, b) => {
    if (b.total_commands !== a.total_commands) return b.total_commands - a.total_commands;
    return a.display_name.localeCompare(b.display_name);
  });

  users.forEach((user, index) => {
    user.rank = index + 1;
  });

  const globalTotalCommands = toNumber(payload.global_total_commands ?? payload.globalTotalCommands, users.reduce((sum, user) => sum + user.total_commands, 0));

  return {
    global_total_commands: globalTotalCommands,
    updated_at: payload.updated_at || new Date().toISOString(),
    users
  };
}

async function getLeaderboard() {
  if (!isRedisConfigured()) {
    return memoryLeaderboard;
  }

  const raw = await getRedis().get(LEADERBOARD_KEY);
  if (!raw) {
    return memoryLeaderboard;
  }

  return JSON.parse(raw);
}

async function setLeaderboard(payload) {
  const normalized = normalizeLeaderboard(payload);

  if (!isRedisConfigured()) {
    memoryLeaderboard = normalized;
    return normalized;
  }

  await getRedis().set(LEADERBOARD_KEY, JSON.stringify(normalized));
  memoryLeaderboard = normalized;

  return normalized;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-secret, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const data = await getLeaderboard();
      return res.status(200).json(data || {
        global_total_commands: 0,
        updated_at: null,
        users: []
      });
    } catch (error) {
      console.error('Leaderboard GET error:', error);
      return res.status(500).json({
        error: 'Failed to fetch leaderboard',
        details: error?.message || String(error)
      });
    }
  }

  if (req.method === 'POST') {
    const body = parseBody(req);
    const secret = getRequestSecret(req, body);

    if (!LEADERBOARD_SECRET || String(secret).trim() !== LEADERBOARD_SECRET) {
      return res.status(401).json({ error: 'Unauthorized: Invalid secret key' });
    }

    if (!Array.isArray(body.users) && !Array.isArray(body)) {
      return res.status(400).json({ error: 'Bad Request: "users" must be an array' });
    }

    try {
      const data = await setLeaderboard(body);

      return res.status(200).json({
        success: true,
        message: 'Leaderboard updated successfully',
        count: data.users.length,
        global_total_commands: data.global_total_commands
      });
    } catch (error) {
      console.error('Leaderboard POST error:', error);
      return res.status(500).json({
        error: 'Failed to save leaderboard',
        details: error?.message || String(error)
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
