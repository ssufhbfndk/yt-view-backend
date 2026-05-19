const db = require("../config/db");

/* =========================
   1. delay TRUE → FALSE
========================= */
const setDelayTrueToFalse = async () => {
  let connObj;

  try {
    console.log("⏳ Running delay=true → false job...");

    connObj = await db.getConnection();
    const conn = connObj.connection;

    await conn.beginTransaction();

    const now = new Date();

    // 🔥 FETCH ELIGIBLE ORDERS
    const [delayTrueOrders] = await conn.query(`
      SELECT od.order_id, od.timestamp, o.type
      FROM order_delay od
      LEFT JOIN orders o ON od.order_id = o.order_id
      WHERE od.delay = true AND od.timestamp <= ?
    `, [now]);

    for (const order of delayTrueOrders) {
      const { order_id, type } = order;

      // check temp
      const [inTemp] = await conn.query(
        "SELECT 1 FROM temp_orders WHERE order_id = ?",
        [order_id]
      );

      // uniform delay 30–45 min
      const randomDelay = 30 + Math.floor(Math.random() * 16);

      const futureTime = new Date(now.getTime() + randomDelay * 60000);
      const tempFutureTime = new Date(now.getTime() + 180 * 60000);

      if (inTemp.length > 0) {
        await conn.query(
          `UPDATE order_delay SET delay = false, timestamp = ? WHERE order_id = ?`,
          [futureTime, order_id]
        );

        await conn.query(
          `UPDATE temp_orders SET delay = false, timestamp = ? WHERE order_id = ?`,
          [tempFutureTime, order_id]
        );

      } else {
        const [inOrders] = await conn.query(
          "SELECT * FROM orders WHERE order_id = ?",
          [order_id]
        );

        if (inOrders.length > 0) {
          const orderData = inOrders[0];

          await conn.query(
            "DELETE FROM orders WHERE order_id = ?",
            [order_id]
          );

          await conn.query(
            `UPDATE order_delay SET delay = false, timestamp = ? WHERE order_id = ?`,
            [futureTime, order_id]
          );

          await conn.query(
            `INSERT INTO temp_orders
            (order_id, video_link, type, remaining, delay, timestamp)
            VALUES (?, ?, ?, ?, false, ?)`,
            [
              orderData.order_id,
              orderData.video_link,
              orderData.type,
              orderData.remaining,
              tempFutureTime
            ]
          );
        }
      }
    }

    await conn.commit();
    console.log("✅ delay=true → false job complete.");

  } catch (error) {
    console.error("❌ Error in delay=true → false:", error);

    try {
      if (connObj) await connObj.connection.rollback();
    } catch (e) {
      console.error("Rollback error:", e);
    }

  } finally {
    if (connObj) connObj.release();
  }
};


/* =========================
   2. delay FALSE → TRUE
========================= */
const setDelayFalseToTrue = async () => {
  let connObj;

  try {
    console.log("⏳ Running delay=false → true job...");

    connObj = await db.getConnection();
    const conn = connObj.connection;

    await conn.beginTransaction();

    const now = new Date();

    // 🔥 FETCH EXPIRED
    const [expiredOrders] = await conn.query(`
      SELECT od.order_id, od.timestamp, t.type
      FROM order_delay od
      LEFT JOIN temp_orders t ON od.order_id = t.order_id
      WHERE od.delay = false AND od.timestamp <= ?
    `, [now]);

    for (const order of expiredOrders) {
      const { order_id, type } = order;

      let addedMinutes;

      if (type === "short") {
        addedMinutes = 100 + Math.floor(Math.random() * 21);
      } else {
        addedMinutes = 50 + Math.floor(Math.random() * 21);
      }

      const delayTimestamp = new Date(
        now.getTime() + addedMinutes * 60000
      );

      // 🔥 update order_delay
      await conn.query(
        `UPDATE order_delay SET delay = true, timestamp = ? WHERE order_id = ?`,
        [delayTimestamp, order_id]
      );

      // 🔥 update temp_orders (if exists)
      await conn.query(
        `UPDATE temp_orders SET delay = true, timestamp = ? WHERE order_id = ?`,
        [now, order_id]
      );
    }

    await conn.commit();
    console.log("✅ delay=false → true job complete.");

  } catch (error) {
    console.error("❌ Error in delay=false → true:", error);

    try {
      if (connObj) await connObj.connection.rollback();
    } catch (e) {
      console.error("Rollback error:", e);
    }

  } finally {
    if (connObj) connObj.release();
  }
};

module.exports = {
  setDelayTrueToFalse,
  setDelayFalseToTrue
};