const db = require('../config/db');

const checkAndUpdateDelayedOrders = async () => {
  console.log("⏳ Running delay update job on order_delay and orders/temp_orders tables...");

  let connection;
  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');

    // Random delay between 90 to 120 minutes
    const randomDelayMinutes = Math.floor(90 + Math.random() * 30);

    // Fetch up to 100 delayed orders for processing
    const [delayedOrders] = await conn.query(
      `SELECT order_id FROM order_delay
       WHERE TIMESTAMPDIFF(MINUTE, timestamp, NOW()) >= ?
       LIMIT 100`,
      [randomDelayMinutes]
    );

    if (delayedOrders.length === 0) {
      console.log("✅ No delayed orders found to update.");
      await conn.query('COMMIT');
      return;
    }

    for (const { order_id } of delayedOrders) {
      // Update delay=false in orders table
      const [orderUpdateResult] = await conn.query(
        `UPDATE orders SET delay = false WHERE order_id = ? AND delay = true`,
        [order_id]
      );

      // If not found in orders, try temp_orders
      if (orderUpdateResult.affectedRows === 0) {
        await conn.query(
          `UPDATE temp_orders SET delay = false WHERE order_id = ? AND delay = true`,
          [order_id]
        );
      }

      // Update delay=false and refresh timestamp in order_delay
      await conn.query(
        `UPDATE order_delay SET delay = false, timestamp = NOW() WHERE order_id = ?`,
        [order_id]
      );

      console.log(`✅ Order ${order_id} updated: delay=false and timestamp refreshed in order_delay.`);
    }

    await conn.query('COMMIT');
    console.log(`🎉 Successfully updated ${delayedOrders.length} delayed orders.`);

  } catch (error) {
    console.error("❌ Error in updating delayed orders:", error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
  }
};

const processOrderDelays = async () => {
  console.log("⏳ Running order delay check job...");

  let connection;
  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query('START TRANSACTION');

    // Random delay threshold between 45 and 60 minutes
    const randomDelayMinutes = Math.floor(45 + Math.random() * 15);

    // 1. Fetch orders from order_delay where delay=false
    // and timestamp difference is >= randomDelayMinutes
    const [ordersToDelay] = await conn.query(
      `SELECT order_id, timestamp 
       FROM order_delay 
       WHERE delay = false 
         AND TIMESTAMPDIFF(MINUTE, timestamp, NOW()) >= ? 
       LIMIT 100`,
      [randomDelayMinutes]
    );

    if (ordersToDelay.length === 0) {
      console.log("✅ No orders to update delay flag.");
      await conn.query('COMMIT');
      return;
    }

    for (const { order_id } of ordersToDelay) {
      // 2. Update delay = true in order_delay and timestamp = NOW()
      await conn.query(
        `UPDATE order_delay 
         SET delay = true, timestamp = NOW() 
         WHERE order_id = ?`,
        [order_id]
      );

      // 3. Update delay = true in orders table (if exists)
      await conn.query(
        `UPDATE orders SET delay = true WHERE order_id = ?`,
        [order_id]
      );

      // 4. Update delay = true in temp_orders table (if exists)
      await conn.query(
        `UPDATE temp_orders SET delay = true WHERE order_id = ?`,
        [order_id]
      );

      console.log(`✅ Order ${order_id} delay set to true.`);
    }

    await conn.query('COMMIT');
    console.log(`🎉 Processed ${ordersToDelay.length} orders for delay update.`);

  } catch (error) {
    console.error("❌ Error in delay processing:", error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { checkAndUpdateDelayedOrders,processOrderDelays,};
