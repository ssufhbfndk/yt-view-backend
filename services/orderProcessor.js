const db = require('../config/db');
const delay = require('../utils/delay');
const { getYouTubeVideoId, isValidYouTubeVideo, getVideoTypeAndDuration } = require('../utils/youtube');

const processPendingOrders = async () => {
  try {
    const pending = await db.queryAsync('SELECT * FROM pending_orders ORDER BY id ASC');

    if (!pending || !Array.isArray(pending) || pending.length === 0) {
      console.log('No pending orders found.');
      return;
    }

    console.log(`Found ${pending.length} pending orders. Processing...`);

    for (const order of pending) {
      try {
        const { id, order_id, video_link, quantity, remaining } = order;

        const videoId = getYouTubeVideoId(video_link);
        if (!videoId) {
          await db.queryAsync(`
            INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp)
            VALUES (?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE timestamp = NOW()
          `, [order_id, video_link, quantity, remaining]);

          await db.queryAsync('DELETE FROM pending_orders WHERE id = ?', [id]);
          console.log(`Invalid YouTube link format: ${video_link}`);
          await delay(2000);
          continue;
        }

        const existing = await db.queryAsync(`
          SELECT order_id FROM orders WHERE order_id = ? OR video_link = ?
          UNION
          SELECT order_id FROM temp_orders WHERE order_id = ? OR video_link = ?
        `, [order_id, video_link, order_id, video_link]);

        if (existing && existing.length > 0) {
          await db.queryAsync(`
            INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp)
            VALUES (?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE timestamp = NOW()
          `, [order_id, video_link, quantity, remaining]);

          await db.queryAsync('DELETE FROM pending_orders WHERE id = ?', [id]);
          console.log(`Duplicate entry found for order_id: ${order_id}`);
          await delay(2000);
          continue;
        }

        const { valid, reason } = await isValidYouTubeVideo(videoId);

        if (!valid) {
          await db.queryAsync(`
            INSERT INTO invalid_orders (order_id, video_link, quantity, remaining, error_reason, timestamp)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE timestamp = NOW(), error_reason = VALUES(error_reason)
          `, [order_id, video_link, quantity, remaining, reason]);

          await db.queryAsync('DELETE FROM pending_orders WHERE id = ?', [id]);
          console.log(`Invalid YouTube Video: ${video_link} - Reason: ${reason}`);
          await delay(2000);
          continue;
        }

        const videoInfo = await getVideoTypeAndDuration(videoId, video_link);
        const finalDuration = videoInfo.finalDuration || 60;

        // Generate random delay seconds (internal use only, not for saving in orders table)
        let randomDelaySeconds;
        if (videoInfo.type === 'short') {
          const minDelay = 90 * 60;
          const maxDelay = 120 * 60;
          randomDelaySeconds = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        } else {
          const minDelay = 60 * 60;
          const maxDelay = 80 * 60;
          randomDelaySeconds = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        }

        // Insert into orders table — delay is boolean (1)
        await db.queryAsync(`
          INSERT INTO orders (order_id, video_link, quantity, remaining, delay, duration, type, timestamp)
          VALUES (?, ?, ?, ?, 1, ?, ?, NOW())
        `, [order_id, video_link, quantity, remaining / videoInfo.multiplier, finalDuration, videoInfo.type]);

        // Insert or update into order_delay table — timestamp delayed by random seconds
        await db.queryAsync(`
          INSERT INTO order_delay (order_id, delay, type, timestamp)
          VALUES (?, ?, ?, NOW() + INTERVAL ? SECOND)
          ON DUPLICATE KEY UPDATE 
            delay = VALUES(delay),
            type = VALUES(type),
            timestamp = VALUES(timestamp)
        `, [order_id, 1, videoInfo.type, randomDelaySeconds]);

        await db.queryAsync('DELETE FROM pending_orders WHERE id = ?', [id]);

        console.log(`✅ Order inserted: ${order_id} | Type: ${videoInfo.type} | Duration: ${finalDuration} | Delay: ${randomDelaySeconds}s`);
        await delay(2000);

      } catch (innerError) {
        console.error(`❌ Error processing order ID ${order.order_id}:`, innerError);
        await delay(2000);
        continue;
      }
    }

    console.log('✅ All pending orders processed.');

  } catch (err) {
    console.error('❌ Error fetching pending orders:', err);
  }
};

module.exports = processPendingOrders;
