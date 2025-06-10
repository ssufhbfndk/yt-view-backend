const db = require('../config/db');

const setDelayTrueToFalse = async () => {
  console.log("⏳ Running delay=true → false job...");

  let connection;
  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');
    const now = new Date();

    // 1. Fetch orders where delay=true and timestamp is expired
    const [delayTrueOrders] = await conn.query(`
      SELECT od.order_id, od.timestamp, o.type
      FROM order_delay od
      LEFT JOIN orders o ON od.order_id = o.order_id
      WHERE od.delay = true AND od.timestamp <= ?
    `, [now]);

    for (const { order_id, type } of delayTrueOrders) {
      // Check in temp_orders
      const [inTemp] = await conn.query(`SELECT * FROM temp_orders WHERE order_id = ?`, [order_id]);

      if (inTemp.length > 0) {
        // Order is in temp_orders → update delay and timestamps
        const randomDelay = type === 'short'
          ? 45 + Math.floor(Math.random() * 16)   // 45–60 min
          : 60 + Math.floor(Math.random() * 61);  // 60–120 min

        const futureTime = new Date(now.getTime() + randomDelay * 60000); // For order_delay
        const tempFutureTime = new Date(now.getTime() + 180 * 60000);     // For temp_orders

        await conn.query(`UPDATE order_delay SET delay = false, timestamp = ? WHERE order_id = ?`, [futureTime, order_id]);
        await conn.query(`UPDATE temp_orders SET delay = false, timestamp = ? WHERE order_id = ?`, [tempFutureTime, order_id]);

      } else {
        // Not in temp_orders → check in orders
        const [inOrders] = await conn.query(`SELECT * FROM orders WHERE order_id = ?`, [order_id]);

        if (inOrders.length > 0) {
          const order = inOrders[0];

          const randomDelay = order.type === 'short'
            ? 45 + Math.floor(Math.random() * 16)
            : 60 + Math.floor(Math.random() * 61);

          const futureTime = new Date(now.getTime() + randomDelay * 60000); // For order_delay
          const tempFutureTime = new Date(now.getTime() + 180 * 60000);     // For temp_orders

          // Delete from orders
          await conn.query(`DELETE FROM orders WHERE order_id = ?`, [order_id]);

          // Update order_delay
          await conn.query(`UPDATE order_delay SET delay = false, timestamp = ? WHERE order_id = ?`, [futureTime, order_id]);

          // Insert into temp_orders
          await conn.query(`
            INSERT INTO temp_orders (order_id, video_link, type, remaining, delay, timestamp)
            VALUES (?, ?, ?, ?, false, ?)`,
            [order.order_id, order.video_link, order.type, order.remaining, tempFutureTime]
          );
        }
      }
    }

    await conn.query('COMMIT');
    console.log("✅ delay=true → false job complete.");
  } catch (error) {
    console.error("❌ Error in delay=true → false:", error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
  }
};



const setDelayFalseToTrue = async () => {
  console.log("⏳ Running delay=false → true job...");

  let connection;
  try {
    connection = await db.getConnection();
    const conn = connection.promise();
    await conn.query('START TRANSACTION');

    const now = new Date();

    // Step 1: Fetch expired delay=false orders
    const [expiredOrders] = await conn.query(`
      SELECT od.order_id, od.timestamp, t.type
      FROM order_delay od
      LEFT JOIN temp_orders t ON od.order_id = t.order_id
      WHERE od.delay = false AND od.timestamp <= ?
    `, [now]);

    for (const order of expiredOrders) {
      const { order_id, type } = order;

      // Calculate random delay based on type
      let addedMinutes;
      if (type === 'short') {
        addedMinutes = 100 + Math.floor(Math.random() * 21); // 100–120 min
      } else {
        addedMinutes = 50 + Math.floor(Math.random() * 21);  // 50–70 min
      }

      const delayTimestamp = new Date(now.getTime() + addedMinutes * 60000);

      // ✅ Step 1: Update order_delay
      await conn.query(`
        UPDATE order_delay
        SET delay = true, timestamp = ?
        WHERE order_id = ?
      `, [delayTimestamp, order_id]);

      // ✅ Step 2: Update temp_orders (if exists)
      await conn.query(`
        UPDATE temp_orders
        SET delay = true, timestamp = ?
        WHERE order_id = ?
      `, [now, order_id]); // temp_orders gets NOW() only
    }

    await conn.query('COMMIT');
  } catch (error) {
    console.error("❌ Error in delay=false → true:", error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  setDelayTrueToFalse,
  setDelayFalseToTrue
};
