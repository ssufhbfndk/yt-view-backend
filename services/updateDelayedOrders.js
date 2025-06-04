const db = require('../config/db');

// 🔁 Converts delay=true → delay=false with new timestamp
const setDelayFalse = async () => {
  console.log("⏳ Running delay=true → false job...");

  let connection;
  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');
    const now = new Date();

    const [delayTrueOrders] = await conn.query(
      `SELECT od.order_id, od.timestamp, o.type 
       FROM order_delay od
       JOIN orders o ON od.order_id = o.order_id
       WHERE od.delay = true`
    );

    for (const { order_id, timestamp, type } of delayTrueOrders) {
      const diffMinutes = (now - new Date(timestamp)) / (1000 * 60);

      if (diffMinutes >= 0) {
        let randomDelayMinutes = type === 'short'
          ? 100 + Math.floor(Math.random() * 21) // 100–120 mins
          : 50 + Math.floor(Math.random() * 21);  // 50–70 mins

        const newTimestamp = new Date(now.getTime() + randomDelayMinutes * 60000);

        await conn.query(
          `UPDATE order_delay SET delay = false, timestamp = ? WHERE order_id = ?`,
          [newTimestamp, order_id]
        );
        await conn.query(`UPDATE orders SET delay = false WHERE order_id = ? AND delay = true`, [order_id]);
        await conn.query(`UPDATE temp_orders SET delay = false WHERE order_id = ? AND delay = true`, [order_id]);
      }
    }

    await conn.query('COMMIT');
    console.log('✅ delay=true → false done.');

  } catch (error) {
    console.error('❌ Error in delay=true → false:', error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
  }
};

// 🔁 Converts delay=false → delay=true with new timestamp
const setDelayTrue = async () => {
  console.log("⏳ Running delay=false → true job...");

  let connection;
  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');
    const now = new Date();

    const [delayFalseOrders] = await conn.query(
      `SELECT od.order_id, od.timestamp, o.type 
       FROM order_delay od
       JOIN orders o ON od.order_id = o.order_id
       WHERE od.delay = false`
    );

    for (const { order_id, timestamp, type } of delayFalseOrders) {
      const diffMinutes = (now - new Date(timestamp)) / (1000 * 60);

      if (diffMinutes >= 0) {
        let randomDelayMinutes = type === 'short'
          ? 45 + Math.floor(Math.random() * 16)   // 45–60 mins
          : 120 + Math.floor(Math.random() * 31); // 120–150 mins

        const newTimestamp = new Date(now.getTime() + randomDelayMinutes * 60000);

        await conn.query(
          `UPDATE order_delay SET delay = true, timestamp = ? WHERE order_id = ?`,
          [newTimestamp, order_id]
        );
        await conn.query(`UPDATE orders SET delay = true WHERE order_id = ? AND delay = false`, [order_id]);
        await conn.query(`UPDATE temp_orders SET delay = true WHERE order_id = ? AND delay = false`, [order_id]);
      }
    }

    await conn.query('COMMIT');
    console.log('✅ delay=false → true done.');

  } catch (error) {
    console.error('❌ Error in delay=false → true:', error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  setDelayTrue,
  setDelayFalse
};
