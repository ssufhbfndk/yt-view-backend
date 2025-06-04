const db = require('../config/db');
const { getYouTubeVideoId, isValidYouTubeVideo, getVideoTypeAndDuration } = require('../utils/youtube');
const util = require('util');

const processPendingOrders = async () => {
  try {
    const connection = await db.getConnection();

    const beginTransaction = util.promisify(connection.beginTransaction).bind(connection);
    const commit = util.promisify(connection.commit).bind(connection);
    const rollback = util.promisify(connection.rollback).bind(connection);
    const query = util.promisify(connection.query).bind(connection);

    // ✅ Fetch ONE random pending order
    const [order] = await query('SELECT * FROM pending_orders ORDER BY RAND() LIMIT 1');

    if (!order) {
      console.log('No pending orders found.');
      connection.release();
      return;
    }


    try {
      await beginTransaction();

      const { id, order_id, video_link, quantity, remaining } = order;

      const videoId = getYouTubeVideoId(video_link);
      if (!videoId) {
        await query(`
          INSERT INTO error_orders (order_id, video_link, quantity, remaining, reason, timestamp)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE timestamp = NOW(), reason = VALUES(reason)
        `, [order_id, video_link, quantity, remaining, 'Invalid YouTube link']);

        await query('DELETE FROM pending_orders WHERE id = ?', [id]);
        console.log(`❌ Invalid YouTube link format: ${video_link}`);

        await rollback();
        connection.release();
        return;
      }

      // ✅ Check if exists in orders or temp_orders
      const existing = await query(`
        SELECT order_id FROM orders WHERE order_id = ? OR video_link = ?
        UNION
        SELECT order_id FROM temp_orders WHERE order_id = ? OR video_link = ?
      `, [order_id, video_link, order_id, video_link]);

      if (existing && existing.length > 0) {
        await query(`
          INSERT INTO error_orders (order_id, video_link, quantity, remaining, reason, timestamp)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE timestamp = NOW(), reason = VALUES(reason)
        `, [order_id, video_link, quantity, remaining, 'Duplicate entry found']);

        await query('DELETE FROM pending_orders WHERE id = ?', [id]);
        console.log(`❌ Duplicate entry found: ${order_id}`);

        await rollback();
        connection.release();
        return;
      }

      // ✅ Check video validity
      const { valid, reason } = await isValidYouTubeVideo(videoId);

      if (!valid) {
        await query(`
          INSERT INTO invalid_orders (order_id, video_link, quantity, remaining, error_reason, timestamp)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE timestamp = NOW(), error_reason = VALUES(error_reason)
        `, [order_id, video_link, quantity, remaining, reason]);

        await query('DELETE FROM pending_orders WHERE id = ?', [id]);
        console.log(`❌ Invalid YouTube Video: ${video_link} - Reason: ${reason}`);

        await rollback();
        connection.release();
        return;
      }

      // ✅ Get video type & duration
      const videoInfo = await getVideoTypeAndDuration(videoId, video_link);
      const finalDuration = videoInfo.finalDuration || 60;

      // ✅ Generate random delay
      let randomDelaySeconds;
      if (videoInfo.type === 'short') {
        randomDelaySeconds = Math.floor(Math.random() * (120 * 60 - 100 * 60 + 1)) + 100 * 60;
      } else {
        randomDelaySeconds = Math.floor(Math.random() * (70 * 60 - 50 * 60 + 1)) + 50 * 60;
      }

      // ✅ Insert into orders
      await query(`
        INSERT IGNORE INTO orders (order_id, video_link, quantity, remaining, delay, duration, type, timestamp)
        VALUES (?, ?, ?, ?, 0, ?, ?, NOW())
      `, [order_id, video_link, quantity, remaining / videoInfo.multiplier, finalDuration, videoInfo.type]);

      // ✅ Insert or update order_delay
      await query(`
        INSERT INTO order_delay (order_id, delay, type, timestamp)
        VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
        ON DUPLICATE KEY UPDATE 
          delay = VALUES(delay),
          type = VALUES(type),
          timestamp = VALUES(timestamp)
      `, [order_id, 0, videoInfo.type, randomDelaySeconds]);

      // ✅ Remove from pending
      await query('DELETE FROM pending_orders WHERE id = ?', [id]);

      await commit();
      console.log(`✅ Order inserted: ${order_id} | Type: ${videoInfo.type} | Duration: ${finalDuration}s | Delay: ${randomDelaySeconds}s`);

    } catch (innerError) {
      await rollback();
      console.error(`❌ Error processing order ID ${order.order_id}:`, innerError);
    }

    connection.release();

  } catch (err) {
    console.error('❌ Error during processing:', err);
  }
};

module.exports = processPendingOrders;
