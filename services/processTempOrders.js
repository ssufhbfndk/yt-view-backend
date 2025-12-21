const db = require('../config/db'); // Your existing DB connection

const processTempOrders = async () => {
  console.log("⏳ Checking temp_orders for processing...");

  let connection;

  try {
    // ✅ Get dedicated connection from pool
    connection = await db.getConnection();
    const conn = connection.promise();

    // ✅ Reduce locking (IMPORTANT)
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');

    // ✅ Start transaction
    await conn.query('START TRANSACTION');

    // ✅ Select eligible temp_orders
    // Shorts: wait >= 10s, Long videos: wait >= 20s
    const [tempOrders] = await conn.query(`
      SELECT *
      FROM temp_orders
      WHERE (
        (video_link LIKE '%youtube.com/shorts%' OR video_link LIKE '%youtu.be/shorts%')
        AND TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= 10
      )
      OR (
        (video_link NOT LIKE '%youtube.com/shorts%' AND video_link NOT LIKE '%youtu.be/shorts%')
        AND TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= 20
      )
      ORDER BY timestamp ASC
      LIMIT 500
    `);

    if (tempOrders.length === 0) {
      console.log("✅ No eligible temp orders found.");
      await conn.query('COMMIT');
      return;
    }

    for (const tempOrder of tempOrders) {
      const {
        order_id,
        video_link,
        channel_name,
        quantity,
        remaining,
        delay,
        type,
        duration,
        wait
      } = tempOrder;

      if (remaining > 0) {
        // ✅ Reinsert into orders table
        await conn.query(`
          INSERT INTO orders (
            order_id, video_link, channel_name,
            quantity, remaining, delay,
            type, duration, wait
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            remaining = VALUES(remaining),
            delay = VALUES(delay),
            type = VALUES(type),
            duration = VALUES(duration),
            wait = VALUES(wait),
            channel_name = VALUES(channel_name)
        `, [
          order_id,
          video_link,
          channel_name,
          quantity,
          remaining,
          delay,
          type,
          duration,
          wait
        ]);
      } else {
        // ✅ Move to complete_orders
        await conn.query(`
          INSERT INTO complete_orders (
            order_id, video_link, channel_name, quantity, timestamp
          )
          VALUES (?, ?, ?, ?, NOW())
        `, [
          order_id,
          video_link,
          channel_name,
          quantity
        ]);
      }

      // ✅ Remove from temp_orders
      await conn.query(
        `DELETE FROM temp_orders WHERE order_id = ?`,
        [order_id]
      );
    }

    await conn.query('COMMIT');
    console.log(`🎉 Successfully processed ${tempOrders.length} temp orders.`);

  } catch (error) {
    console.error("❌ Error processing temp_orders:", error);
    try {
      if (connection) {
        await connection.promise().query('ROLLBACK');
      }
    } catch (rbErr) {
      console.error("❌ Rollback failed:", rbErr);
    }
  } finally {
    if (connection) connection.release();
  }
};

module.exports = processTempOrders;
