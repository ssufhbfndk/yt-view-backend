const db = require('../config/db');

const updateDelayFlagsAndTimestamps = async () => {
  console.log("⏳ Running delay flag and timestamp update job...");

  let connection;
  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');

    const now = new Date();

    // delay = true → false
    const [delayTrueOrders] = await conn.query(
      `SELECT od.order_id, od.timestamp, o.type 
       FROM order_delay od
       JOIN orders o ON od.order_id = o.order_id
       WHERE od.delay = true`
    );

    for (const { order_id, timestamp, type } of delayTrueOrders) {
      const diffMinutes = (now - new Date(timestamp)) / (1000 * 60);

      if (diffMinutes >= 0) {
        let randomDelayMinutes;

        if (type === 'short') {
          // 👇 45-60 mins delay
          randomDelayMinutes = 45 + Math.floor(Math.random() * 16);
        } else {
          // 👇 150-180 mins delay
          randomDelayMinutes = 150 + Math.floor(Math.random() * 31);
        }

        const newTimestamp = new Date(now.getTime() + randomDelayMinutes * 60000);

        await conn.query(
          `UPDATE order_delay SET delay = false, timestamp = ? WHERE order_id = ?`,
          [newTimestamp, order_id]
        );

        await conn.query(
          `UPDATE orders SET delay = false WHERE order_id = ? AND delay = true`,
          [order_id]
        );
        await conn.query(
          `UPDATE temp_orders SET delay = false WHERE order_id = ? AND delay = true`,
          [order_id]
        );

        
      }
    }

    // delay = false → true
    const [delayFalseOrders] = await conn.query(
      `SELECT od.order_id, od.timestamp, o.type 
       FROM order_delay od
       JOIN orders o ON od.order_id = o.order_id
       WHERE od.delay = false`
    );

    for (const { order_id, timestamp, type } of delayFalseOrders) {
      const diffMinutes = (now - new Date(timestamp)) / (1000 * 60);

      if (diffMinutes >= 0) {
        let randomDelayMinutes;

        if (type === 'short') {
          // 👇 90–120 mins delay
          randomDelayMinutes = 90 + Math.floor(Math.random() * 31);
        } else {
          // 👇 60–80 mins delay
          randomDelayMinutes = 40 + Math.floor(Math.random() * 21);
        }

        const newTimestamp = new Date(now.getTime() + randomDelayMinutes * 60000);

        await conn.query(
          `UPDATE order_delay SET delay = true, timestamp = ? WHERE order_id = ?`,
          [newTimestamp, order_id]
        );

        await conn.query(
          `UPDATE orders SET delay = true WHERE order_id = ? AND delay = false`,
          [order_id]
        );
        await conn.query(
          `UPDATE temp_orders SET delay = true WHERE order_id = ? AND delay = false`,
          [order_id]
        );

       
      }
    }

    await conn.query('COMMIT');
    console.log('🎉 Delay flags and timestamps updated successfully.');

  } catch (error) {
    console.error('❌ Error updating delay flags and timestamps:', error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
  }
};

module.exports = updateDelayFlagsAndTimestamps;
