require('dotenv').config();
const axios = require('axios');
const db = require('../config/db');
const getYouTubeVideoId = require('../utils/getYouTubeVideoId'); // adjust path if needed

const fetchNewOrders = async () => {
  try {
    const response = await axios.post('https://watchtimehub.com/api/v2', {
      key: process.env.API_KEY,
      action: 'orders',
      service: process.env.SERVICE_ID
    });

    if (!response || !response.data || !Array.isArray(response.data)) {
      console.log('⚠️ No valid orders received.');
      return;
    }

    const orders = response.data;
    console.log(`📦 Fetched ${orders.length} orders from WatchTimeHub`);

    for (const order of orders) {
      const { order: order_id, link: video_link, quantity, remains } = order;

      try {
        const exists = await db.queryAsync(
          'SELECT order_id FROM pending_orders WHERE order_id = ?',
          [order_id]
        );

        if (exists.length > 0) {
          console.log(`⚠️ Order already exists: ${order_id}`);
          await db.queryAsync(`
            INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp, reason)
            VALUES (?, ?, ?, ?, NOW(), ?)
            ON DUPLICATE KEY UPDATE timestamp = NOW(), reason = ?
          `, [order_id, video_link, quantity, remains, 'Already exists in pending_orders', 'Already exists in pending_orders']);
          continue;
        }

        // Validate YouTube video ID
        const videoId = getYouTubeVideoId(video_link);
        if (!videoId) {
          await db.queryAsync(`
            INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp, reason)
            VALUES (?, ?, ?, ?, NOW(), ?)
            ON DUPLICATE KEY UPDATE timestamp = NOW(), reason = ?
          `, [order_id, video_link, quantity, remains, 'Invalid YouTube link', 'Invalid YouTube link']);
          console.log(`❌ Invalid link: ${video_link}`);
          continue;
        }

        // Check for Shorts format
        if (!video_link.includes('/shorts/')) {
          await db.queryAsync(`
            INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp, reason)
            VALUES (?, ?, ?, ?, NOW(), ?)
            ON DUPLICATE KEY UPDATE timestamp = NOW(), reason = ?
          `, [order_id, video_link, quantity, remains, 'Not a Shorts link', 'Not a Shorts link']);
          console.log(`❌ Not a Shorts video: ${video_link}`);
          continue;
        }

        // Add 15% extra remaining
        const remainingWithExtra = Math.ceil(remains * 1.15);

        // Final insert
        await db.queryAsync(`
          INSERT INTO pending_orders (order_id, video_link, quantity, remaining, timestamp)
          VALUES (?, ?, ?, ?, NOW())
        `, [order_id, video_link, quantity, remainingWithExtra]);

        console.log(`✅ Order inserted: ${order_id}`);
      } catch (innerError) {
        // Fallback for any unexpected per-order error
        await db.queryAsync(`
          INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp, reason)
          VALUES (?, ?, ?, ?, NOW(), ?)
          ON DUPLICATE KEY UPDATE timestamp = NOW(), reason = ?
        `, [order_id, video_link, quantity, remains, 'Unexpected insert error', 'Unexpected insert error']);

        console.error(`❌ Order failed (saved in error_orders): ${order_id}`, innerError.message);
      }
    }
  } catch (error) {
    console.error('❌ Failed to fetch orders from API:', error.message);
  }
};

module.exports = fetchNewOrders;
