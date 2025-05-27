const db = require('../config/db'); // Database connection

const processTempOrders = async () => {
  console.log("⏳ Checking temp_orders for processing (LIMIT 500)...");

  let connection;

  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');

    // Fetch up to 500 eligible orders
    const [tempOrders] = await conn.query(`
      SELECT * FROM temp_orders
      WHERE (
        (video_link LIKE '%youtube.com/shorts%' OR video_link LIKE '%youtu.be/shorts%')
        AND TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= 30
      )
      OR (
        (video_link NOT LIKE '%youtube.com/shorts%' AND video_link NOT LIKE '%youtu.be/shorts%')
        AND TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= 240
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
      const { order_id, video_link, quantity, remaining } = tempOrder;

      if (remaining > 0) {
        await conn.query(`
          INSERT INTO orders (order_id, video_link, quantity, remaining)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE remaining = VALUES(remaining)
        `, [order_id, video_link, quantity, remaining]);

      } else {
        await conn.query(`
          INSERT INTO complete_orders (order_id, video_link, quantity, timestamp)
          VALUES (?, ?, ?, NOW())
        `, [order_id, video_link, quantity]);

      }

      await conn.query(
        `DELETE FROM temp_orders WHERE order_id = ?`,
        [order_id]
      );

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
