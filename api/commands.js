import { kv } from '@vercel/kv';

// Secret key must be set in Vercel Environment Variables as COMMANDS_SECRET
const SECRET = process.env.COMMANDS_SECRET;

export default async function handler(req, res) {
  // CORS headers (optional but helpful for testing)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ==================== GET ====================
  if (req.method === 'GET') {
    try {
      const data = await kv.get('zne-commands');
      
      if (data && Array.isArray(data.commands)) {
        return res.status(200).json(data);
      }
      
      // No data in KV yet
      return res.status(200).json({ commands: [] });
    } catch (error) {
      console.error('KV GET error:', error);
      return res.status(500).json({ error: 'Failed to fetch commands from KV' });
    }
  }

  // ==================== POST (from bot) ====================
  if (req.method === 'POST') {
    const { commands, secret } = req.body || {};

    // Validate secret
    if (!SECRET || secret !== SECRET) {
      return res.status(401).json({ error: 'Unauthorized: Invalid secret key' });
    }

    // Validate payload
    if (!Array.isArray(commands)) {
      return res.status(400).json({ error: 'Bad Request: "commands" must be an array' });
    }

    try {
      // Store in the exact shape the frontend expects
      await kv.set('zne-commands', { commands });

      return res.status(200).json({
        success: true,
        message: 'Command list updated successfully',
        count: commands.length
      });
    } catch (error) {
      console.error('KV SET error:', error);
      return res.status(500).json({ error: 'Failed to save commands to KV' });
    }
  }

  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}
