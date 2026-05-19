const db = require("../config/db");

const processTempOrders = async () => {

  try {
    console.log("🔗 DB CONNECTION OK");

    // ================================
    // ⚡ MAIN TRANSACTION
    // ================================
    const processedCount = await db.withTransaction(async (conn) => {

      // ================================
      // ⚡ STEP 1: FETCH READY ORDERS
      // ================================
      const [tempOrders] = await conn.query(`
        SELECT *
        FROM temp_orders
        WHERE \`timestamp\` <= NOW()
        LIMIT 500
        FOR UPDATE
      `);

      console.log("📦 FOUND:", tempOrders.length);

      if (!tempOrders.length) {
        return 0;
      }

      // ================================
      // ⚡ STEP 2: BULK PREP
      // ================================
      const ordersValues = [];
      const deleteIds = [];

      for (const order of tempOrders) {
        const orderId = order.order_id.trim();

        ordersValues.push([
          orderId,
          order.video_link,
          order.channel_name,
          order.quantity,
          order.remaining,
          order.delay,
          order.type,
          order.duration,
          order.wait
        ]);

        deleteIds.push(orderId);
      }

      // ================================
      // ⚡ STEP 3: BULK UPSERT
      // ================================
      await conn.query(
        `
        INSERT INTO orders
        (order_id, video_link, channel_name, quantity, remaining, delay, type, duration, wait)
        VALUES ?
        ON DUPLICATE KEY UPDATE
          remaining = VALUES(remaining),
          delay = VALUES(delay),
          type = VALUES(type),
          duration = VALUES(duration),
          wait = VALUES(wait),
          channel_name = VALUES(channel_name)
        `,
        [ordersValues]
      );

      // ================================
      // ⚡ STEP 4: BULK DELETE
      // ================================
      await conn.query(
        `
        DELETE FROM temp_orders
        WHERE order_id IN (?)
        `,
        [deleteIds]
      );

      return tempOrders.length;
    });

    console.log(`🎉 DONE: ${processedCount} orders processed`);

  } catch (err) {
    console.error("❌ ERROR:", err.message);
  }
};

module.exports = processTempOrders;