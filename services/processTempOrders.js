const db = require('../config/db'); // Database connection

const processTempOrders = async () => {
  console.log("⏳ Checking temp_orders for processing (LIMIT 500)...");

  let connection;

  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');

    // Fetch up to 500 eligible orders with randomized delay
    const [tempOrders] = await conn.query(`
      SELECT *, 
        CASE
          WHEN (video_link LIKE '%youtube.com/shorts%' OR video_link LIKE '%youtu.be/shorts%')
            THEN FLOOR(100 + (RAND() * 100)) -- 100 to 200 sec
          ELSE FLOOR(420 + (RAND() * 480))  -- 7 to 15 min
        END AS random_wait_time
      FROM temp_orders
      WHERE (
        (video_link LIKE '%youtube.com/shorts%' OR video_link LIKE '%youtu.be/shorts%')
          AND TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= FLOOR(100 + (RAND() * 100))
      )
      OR (
        (video_link NOT LIKE '%youtube.com/shorts%' AND video_link NOT LIKE '%youtu.be/shorts%')
          AND TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= FLOOR(420 + (RAND() * 480))
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

      const isShort = video_link.includes("youtube.com/shorts") || video_link.includes("youtu.be/shorts");
      const concurrentUsers = isShort ? 2 : 5;

      if (remaining > 0) {
        await conn.query(`
          INSERT INTO orders (order_id, video_link, quantity, remaining, concurrent_users)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE remaining = VALUES(remaining), concurrent_users = VALUES(concurrent_users)
        `, [order_id, video_link, quantity, remaining, concurrentUsers]);

        console.log(`🔄 Order ${order_id} returned to orders table with concurrent_users = ${concurrentUsers}.`);
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
