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

    // ✅ Start transaction
    await beginTransaction();

    // ✅ Fetch 1 order
    const [order] = await query(`
      SELECT * FROM pending_orders
      ORDER BY RAND()
      LIMIT 1
    `);

    if (!order) {
      console.log('⚠️ No pending orders found.');
      await rollback();
      connection.release();
      return;
    }

    const { id, order_id, video_link, quantity, remaining } = order;

    // ✅ Delete from pending_orders immediately to avoid double processing
    await query('DELETE FROM pending_orders WHERE id = ?', [id]);
    await commit(); // Commit deletion only
    connection.release();

    console.log(`➡️ Picked order: ${order_id} | Removed from pending_orders`);

    // ❗ Now continue rest of the logic in a new connection
    const conn = await db.getConnection();
    const query2 = util.promisify(conn.query).bind(conn);
    const begin = util.promisify(conn.beginTransaction).bind(conn);
    const commit2 = util.promisify(conn.commit).bind(conn);
    const rollback2 = util.promisify(conn.rollback).bind(conn);

    try {
      await begin();

      const videoId = getYouTubeVideoId(video_link);
      if (!videoId) {
        await query2(`
          INSERT INTO error_orders (order_id, video_link, quantity, remaining, reason, timestamp)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE timestamp = NOW(), reason = VALUES(reason)
        `, [order_id, video_link, quantity, remaining, 'Invalid YouTube link']);
        console.log(`❌ Invalid YouTube link: ${video_link}`);
        await commit2();
        conn.release();
        return;
      }

      // ✅ Check if order already exists
      const existing = await query2(`
        SELECT order_id FROM orders WHERE order_id = ? OR video_link = ?
        UNION
        SELECT order_id FROM temp_orders WHERE order_id = ? OR video_link = ?
      `, [order_id, video_link, order_id, video_link]);

      if (existing.length > 0) {
        await query2(`
          INSERT INTO error_orders (order_id, video_link, quantity, remaining, reason, timestamp)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE timestamp = NOW(), reason = VALUES(reason)
        `, [order_id, video_link, quantity, remaining, 'Duplicate entry']);
        console.log(`❌ Duplicate order: ${order_id}`);
        await commit2();
        conn.release();
        return;
      }

      // ✅ Validate YouTube video
      const { valid, reason } = await isValidYouTubeVideo(videoId);
      if (!valid) {
        await query2(`
          INSERT INTO invalid_orders (order_id, video_link, quantity, remaining, error_reason, timestamp)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE timestamp = NOW(), error_reason = VALUES(error_reason)
        `, [order_id, video_link, quantity, remaining, reason]);
        console.log(`❌ Invalid YouTube video: ${video_link} | Reason: ${reason}`);
        await commit2();
        conn.release();
        return;
      }

      // ✅ Get video duration & type
      const videoInfo = await getVideoTypeAndDuration(videoId, video_link);
      const finalDuration = videoInfo.finalDuration || 60;

      // ✅ Generate delay
      let randomDelaySeconds;
      if (videoInfo.type === 'short') {
        randomDelaySeconds = Math.floor(Math.random() * (120 * 60 - 100 * 60 + 1)) + 100 * 60;
      } else {
        randomDelaySeconds = Math.floor(Math.random() * (70 * 60 - 50 * 60 + 1)) + 50 * 60;
      }

      const futureTimestamp = new Date(Date.now() + randomDelaySeconds * 1000);

      // ✅ Insert into orders (delay = 1 always)
      await query2(`
        INSERT IGNORE INTO orders 
        (order_id, video_link, quantity, remaining, delay, duration, type, timestamp)
        VALUES (?, ?, ?, ?, 1, ?, ?, NOW())
      `, [order_id, video_link, quantity, remaining / videoInfo.multiplier, finalDuration, videoInfo.type]);

       // ✅ Insert into `order_delay` with delay = 1 but future timestamp based on actual delay
      await query2(`
        INSERT INTO order_delay 
        (order_id, delay, type, timestamp)
        VALUES (?, 1, ?, ?)
        ON DUPLICATE KEY UPDATE 
          delay = 1,
          type = VALUES(type),
          timestamp = VALUES(timestamp)
      `, [order_id, videoInfo.type, futureTimestamp]);

      await commit2();
      conn.release();

      console.log(`✅ Order processed: ${order_id} | Type: ${videoInfo.type} | Delay: ${randomDelaySeconds}s`);

    } catch (err2) {
      await rollback2();
      conn.release();
      console.error(`❌ Processing failed for order ${order_id}:`, err2);
    }

  } catch (err) {
    console.error('❌ Critical DB Error:', err);
  }
};

module.exports = processPendingOrders;
