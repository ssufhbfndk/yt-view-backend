const db = require('../config/db'); // Database connection

const processTempOrders = async () => {
  console.log("⏳ Checking temp_orders for processing (LIMIT 500)...");

  let connection;

  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');

    // Updated wait time: 10s for shorts, 20s for long videos
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
      LIMIT 500
      FOR UPDATE
    `);

    if (tempOrders.length === 0) {
      console.log("✅ No eligible temp orders found.");
      await conn.query('COMMIT');
      return;
    }

    for (const tempOrder of tempOrders) {
      const { order_id, video_link, quantity, remaining, delay } = tempOrder;

      if (remaining > 0) {
        // Re-insert into orders table with same delay value
        await conn.query(`
          INSERT INTO orders (order_id, video_link, quantity, remaining, delay)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE remaining = VALUES(remaining), delay = VALUES(delay)
        `, [order_id, video_link, quantity, remaining, delay]);

        console.log(`🔄 Order ${order_id} re-inserted into orders with delay=${delay}.`);
      } else {
        // Move to complete_orders if no remaining
        await conn.query(`
          INSERT INTO complete_orders (order_id, video_link, quantity, timestamp)
          VALUES (?, ?, ?, NOW())
        `, [order_id, video_link, quantity]);

        console.log(`✅ Order ${order_id} moved to complete_orders.`);
      }

      // Delete from temp_orders
      await conn.query(
        `DELETE FROM temp_orders WHERE order_id = ?`,
        [order_id]
      );

      console.log(`🗑️ Order ${order_id} deleted from temp_orders.`);
    }

    await conn.query('COMMIT');
    console.log(`🎉 Successfully processed ${tempOrders.length} orders.`);

  } catch (error) {
    console.error("❌ Error processing temp_orders:", error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
  }
};

module.exports = processTempOrders;
