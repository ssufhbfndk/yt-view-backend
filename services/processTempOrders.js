
const db = require('../config/db'); // apne db connection ka path set karein

const processTempOrders = async () => {
  console.log("⏳ Checking temp_orders for processing...");

  let connection;

  try {
    connection = await db.getConnection();

    const conn = connection.promise();

    await conn.query('START TRANSACTION');

    const [tempOrders] = await conn.query(`
      SELECT * FROM temp_orders
      WHERE TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= 60
      FOR UPDATE
    `);

    if (tempOrders.length === 0) {
      console.log("✅ No temp orders to process.");
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

        console.log(`🔄 Order ${order_id} moved back to orders table.`);
      } else {
        await conn.query(`
          INSERT INTO complete_orders (order_id, video_link, quantity, timestamp)
          VALUES (?, ?, ?, NOW())
        `, [order_id, video_link, quantity]);

        console.log(`✅ Order ${order_id} moved to complete_orders.`);
      }

      await conn.query(
        `DELETE FROM temp_orders WHERE order_id = ?`,
        [order_id]
      );

      console.log(`🗑️ Order ${order_id} removed from temp_orders.`);
    }

    await conn.query('COMMIT');
    console.log("🎉 All eligible temp_orders processed successfully.");
  } catch (error) {
    console.error("❌ Error during temp_orders processing:", error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
  }
};

module.exports = processTempOrders;
