const express = require('express');
const router = express.Router();
const db = require('../config/db');
const getYouTubeVideoId = require('../utils/youtube');

const YOUR_SECRET_API_KEY = process.env.EXTERNAL_API_KEY || 'yt_external_api_1234'; // Save this in .env

router.post('/external-order', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const { order_id, video_link, quantity } = req.body;

  // API key check
  if (!apiKey || apiKey !== YOUR_SECRET_API_KEY) {
    return res.status(403).json({ error: 'Unauthorized. Invalid API key.' });
  }

  // Required fields check
  if (!order_id || !video_link || !quantity) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // YouTube ID check
  const videoId = getYouTubeVideoId(video_link);
  if (!videoId) {
    await logError(order_id, video_link, quantity, 0, 'Invalid YouTube link');
    return res.status(400).json({ error: 'Invalid YouTube video link.' });
  }

  // Shorts format check
  if (!video_link.includes('/shorts/')) {
    await logError(order_id, video_link, quantity, 0, 'Not a Shorts link');
    return res.status(400).json({ error: 'Only Shorts videos are supported.' });
  }

  try {
    // Check if order already exists
    const existing = await db.queryAsync('SELECT order_id FROM pending_orders WHERE order_id = ?', [order_id]);
    if (existing.length > 0) {
      await logError(order_id, video_link, quantity, 0, 'Duplicate order');
      return res.status(409).json({ error: 'Order already exists.' });
    }

    const remainingWithExtra = Math.ceil(quantity * 1.15);

    await db.queryAsync(`
      INSERT INTO pending_orders (order_id, video_link, quantity, remaining, timestamp)
      VALUES (?, ?, ?, ?, NOW())
    `, [order_id, video_link, quantity, remainingWithExtra]);

    return res.status(201).json({ message: '✅ Order added successfully.' });
  } catch (err) {
    await logError(order_id, video_link, quantity, 0, 'Database insert error');
    return res.status(500).json({ error: 'Server error. Order could not be added.' });
  }
});

// Helper to log errors
async function logError(order_id, video_link, quantity, remaining, reason) {
  await db.queryAsync(`
    INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp, reason)
    VALUES (?, ?, ?, ?, NOW(), ?)
    ON DUPLICATE KEY UPDATE timestamp = NOW(), reason = ?
  `, [order_id, video_link, quantity, remaining, reason, reason]);
}

module.exports = router;
