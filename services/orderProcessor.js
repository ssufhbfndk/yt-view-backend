const db = require('../config/db');
const delay = require('../utils/delay');
const { getYouTubeVideoId, isValidYouTubeVideo, getVideoTypeAndDuration } = require('../utils/youtube');
const util = require('util');

const processPendingOrders = async () => {
  try {
    const connection = await db.getConnection();

    const beginTransaction = util.promisify(connection.beginTransaction).bind(connection);
    const commit = util.promisify(connection.commit).bind(connection);
    const rollback = util.promisify(connection.rollback).bind(connection);
    const query = util.promisify(connection.query).bind(connection);

    const pending = await query('SELECT * FROM pending_orders ORDER BY id ASC');

    if (!pending || !Array.isArray(pending) || pending.length === 0) {
      console.log('No pending orders found.');
      connection.release();
      return;
    }

    console.log(`Found ${pending.length} pending orders. Processing...`);

    for (const order of pending) {
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
          console.log(`Invalid YouTube link format: ${video_link}`);

          await rollback();
          await delay(2000);
          continue;
        }

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
          console.log(`Duplicate entry found for order_id: ${order_id}`);

          await rollback();
          await delay(2000);
          continue;
        }

        const { valid, reason } = await isValidYouTubeVideo(videoId);

        if (!valid) {
          await query(`
            INSERT INTO invalid_orders (order_id, video_link, quantity, remaining, error_reason, timestamp)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE timestamp = NOW(), error_reason = VALUES(error_reason)
          `, [order_id, video_link, quantity, remaining, reason]);

          await query('DELETE FROM pending_orders WHERE id = ?', [id]);
          console.log(`Invalid YouTube Video: ${video_link} - Reason: ${reason}`);

          await rollback();
          await delay(2000);
          continue;
        }

        const videoInfo = await getVideoTypeAndDuration(videoId, video_link);
        const finalDuration = videoInfo.finalDuration || 60;

        let randomDelaySeconds;
        if (videoInfo.type === 'short') {
          randomDelaySeconds = Math.floor(Math.random() * (120 * 60 - 100 * 60 + 1)) + 100 * 60;
        } else {
          randomDelaySeconds = Math.floor(Math.random() * (70 * 60 - 50 * 60 + 1)) + 50 * 60;
        }

        // ✅ INSERT IGNORE into orders to prevent duplicates
        await query(`
          INSERT IGNORE INTO orders (order_id, video_link, quantity, remaining, delay, duration, type, timestamp)
          VALUES (?, ?, ?, ?, 0, ?, ?, NOW())
        `, [order_id, video_link, quantity, remaining / videoInfo.multiplier, finalDuration, videoInfo.type]);

        // ✅ Insert or update delay config
        await query(`
          INSERT INTO order_delay (order_id, delay, type, timestamp)
          VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
          ON DUPLICATE KEY UPDATE 
            delay = VALUES(delay),
            type = VALUES(type),
            timestamp = VALUES(timestamp)
        `, [order_id, 0, videoInfo.type, randomDelaySeconds]);

        // ✅ Clean up pending order
        await query('DELETE FROM pending_orders WHERE id = ?', [id]);

        await commit();

        console.log(`✅ Order inserted: ${order_id} | Type: ${videoInfo.type} | Duration: ${finalDuration} | Delay: ${randomDelaySeconds}s`);
        await delay(2000);

      } catch (innerError) {
        await rollback();
        console.error(`❌ Error processing order ID ${order.order_id}:`, innerError);
        await delay(2000);
        continue;
      }
    }

    connection.release();
    console.log('✅ All pending orders processed.');

  } catch (err) {
    console.error('❌ Error fetching pending orders:', err);
  }
};

module.exports = processPendingOrders;
