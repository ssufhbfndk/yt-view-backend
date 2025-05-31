const db = require('../config/db');

const updateDelayFlagsAndTimestamps = async () => {
  console.log("⏳ Running delay flag and timestamp update job...");

  let connection;
  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');

    const now = new Date();

    // 1. Handle orders with delay = true, check if timestamp expired
    const [delayTrueOrders] = await conn.query(
      `SELECT order_id, timestamp FROM order_delay WHERE delay = true`
    );

    for (const { order_id, timestamp } of delayTrueOrders) {
      const diffMinutes = (now - new Date(timestamp)) / (1000 * 60);

      // Agar time expire ho gaya hai (current time timestamp se aage)
      if (diffMinutes >= 0) {
        // Random delay 30-45 minutes
        const randomDelayMinutes = 30 + Math.floor(Math.random() * 16);
        const newTimestamp = new Date(now.getTime() + randomDelayMinutes * 60000);

        // Update order_delay: delay = false, new timestamp
        await conn.query(
          `UPDATE order_delay SET delay = false, timestamp = ? WHERE order_id = ?`,
          [newTimestamp, order_id]
        );

        // Update orders and temp_orders delay flags to false
        await conn.query(
          `UPDATE orders SET delay = false WHERE order_id = ? AND delay = true`,
          [order_id]
        );
        await conn.query(
          `UPDATE temp_orders SET delay = false WHERE order_id = ? AND delay = true`,
          [order_id]
        );

        console.log(`Order ${order_id} delay=true expired → set delay=false, timestamp +${randomDelayMinutes} mins`);
      }
    }

    // 2. Handle orders with delay = false, check if timestamp expired
    const [delayFalseOrders] = await conn.query(
      `SELECT order_id, timestamp FROM order_delay WHERE delay = false`
    );

    for (const { order_id, timestamp } of delayFalseOrders) {
      const diffMinutes = (now - new Date(timestamp)) / (1000 * 60);

      if (diffMinutes >= 0) {
        // Random delay 90-120 minutes
        const randomDelayMinutes = 90 + Math.floor(Math.random() * 31);
        const newTimestamp = new Date(now.getTime() + randomDelayMinutes * 60000);

        // Update order_delay: delay = true, new timestamp
        await conn.query(
          `UPDATE order_delay SET delay = true, timestamp = ? WHERE order_id = ?`,
          [newTimestamp, order_id]
        );

        // Update orders and temp_orders delay flags to true
        await conn.query(
          `UPDATE orders SET delay = true WHERE order_id = ? AND delay = false`,
          [order_id]
        );
        await conn.query(
          `UPDATE temp_orders SET delay = true WHERE order_id = ? AND delay = false`,
          [order_id]
        );

        console.log(`Order ${order_id} delay=false expired → set delay=true, timestamp +${randomDelayMinutes} mins`);
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
