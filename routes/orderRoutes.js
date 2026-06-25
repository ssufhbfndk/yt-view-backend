const express = require('express');
const router = express.Router();
const db = require('../config/db');  // Assuming db.js is where your MySQL connection is set up
const {verifyAdminToken} = require("../middleware/authMiddleware");
const { getOrdersData} = require("../controllers/adminFunctionsController");
router.post("/fetch-order", async (req, res) => {
  const { username, ip, model } = req.body;

  // ✅ Validation
  if (!username || !ip || !model) {
    return res.status(400).json({
      success: false,
      message: "Username, IP and Model required"
    });
  }

  if (!username.match(/^[a-zA-Z0-9_]+$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid username"
    });
  }

  const profileTable = `profile_${username}`;

  try {
    const result = await db.withTransaction(async (conn) => {

      // 🔥 MAIN FILTER QUERY
     const [orders] = await conn.query(
  `
  SELECT o.order_id, o.video_link, o.channel_name, o.type,
         o.quantity, o.remaining, o.delay, o.duration, o.wait
  FROM orders o
  WHERE o.delay = TRUE

  -- ✅ USER LIMIT (3 per channel)
  AND (
    SELECT COUNT(*)
    FROM \`${profileTable}\` p
    WHERE p.channel_name = o.channel_name
  ) < 3

  -- ❌ SAME IP SAME ORDER BLOCK
  AND NOT EXISTS (
    SELECT 1 FROM order_ip_tracking ipt
    WHERE ipt.order_id = o.order_id
      AND ipt.ip_address = ?
  )

  -- ✅ IP LIMIT (3 per channel)
  AND (
    SELECT COUNT(*)
    FROM order_ip_tracking ipt2
    WHERE ipt2.channel_name = o.channel_name
      AND ipt2.ip_address = ?
  ) < 3

  -- ❌ MODEL SAME ORDER BLOCK
  AND NOT EXISTS (
    SELECT 1 FROM model_devices md2
    WHERE md2.model = ?
      AND md2.order_id = o.order_id
  )

  -- ❌ MODEL LIMIT (3 per channel)
  AND (
    SELECT COUNT(*)
    FROM model_devices md
    WHERE md.model = ?
      AND md.channel_name = o.channel_name
  ) < 3

  -- ❌ PROFILE TABLE ORDER DUPLICATE BLOCK (NEW FIX)
  AND NOT EXISTS (
    SELECT 1
    FROM \`${profileTable}\` p
    WHERE p.order_id = o.order_id
  )

  ORDER BY o.id DESC
  LIMIT 1
  FOR UPDATE
  `,
  [ip, ip, model, model]
);

      if (!orders.length) {
        return { success: false };
      }

      const order = orders[0];
      const currentRemaining = parseInt(order.remaining, 10) || 0;

      // 🔥 IP TRACKING (UPDATED - NO TYPE)
      await conn.query(
        `
        INSERT INTO order_ip_tracking
        (order_id, ip_address, count, channel_name, timestamp)
        VALUES (?, ?, 1, ?, NOW())
        ON DUPLICATE KEY UPDATE
          count = count + 1,
          channel_name = VALUES(channel_name),
          timestamp = NOW()
        `,
        [order.order_id, ip, order.channel_name]
      );

      // 🔥 MODEL DEVICES (UPDATED - WITH TIMESTAMP)
      await conn.query(
        `
        INSERT INTO model_devices
        (model, order_id, channel_name, timestamp)
        VALUES (?, ?, ?, NOW())
        `,
        [model, order.order_id, order.channel_name]
      );

      // 🔥 ORDER PROCESS
    if (currentRemaining <= 0) {

  await conn.query(
    `INSERT INTO complete_orders
     (
       order_id,
       type,
       duration,
       video_link,
       channel_name,
       quantity,
       timestamp
     )
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [
      order.order_id,
      order.type,
      order.duration,
      order.video_link,
      order.channel_name,
      order.quantity
    ]
  );

  const [skipOrder] = await conn.query(
    `SELECT id
     FROM skip_point
     WHERE order_id = ?
     LIMIT 1`,
    [order.order_id]
  );

  if (skipOrder.length > 0) {
    await conn.query(
      `DELETE FROM skip_point
       WHERE order_id = ?`,
      [order.order_id]
    );
  }

  await conn.query(
    `DELETE FROM orders
     WHERE order_id = ?`,
    [order.order_id]
  );

} else {

        const delayPool = [45,60,75,90,120,150,180,210,240,270,300];
        const delaySeconds = delayPool[Math.floor(Math.random() * delayPool.length)];

        await conn.query(
          `INSERT INTO temp_orders
           (order_id, video_link, quantity, remaining, delay, type, duration, wait, channel_name, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
          [
            order.order_id,
            order.video_link,
            order.quantity,
            currentRemaining,
            order.delay,
            order.type,
            order.duration,
            delaySeconds,
            order.channel_name,
            delaySeconds
          ]
        );

        await conn.query(
          `DELETE FROM orders WHERE order_id = ?`,
          [order.order_id]
        );
      }

      // 🔥 PROFILE TABLE (UPDATED - NO VIDEO, NO TYPE)
      await conn.query(
        `INSERT INTO \`${profileTable}\`
         (order_id, channel_name, timestamp)
         VALUES (?, ?, NOW())`,
        [order.order_id, order.channel_name]
      );

      return {
        success: true,
        order
      };
    });

    if (!result || !result.success) {
      return res.json({
        success: false,
        message: "No new orders found"
      });
    }

    return res.json({
      success: true,
      order: result.order
    });

  } catch (error) {
    console.error("❌ fetch-order error:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
});
//add muliti order
router.post("/multi-orders",verifyAdminToken, async (req, res) => {
  const { orders } = req.body;

  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid orders format",
    });
  }

  const failedOrders = [];
  const successOrders = [];

  try {
    await db.withTransaction(async (conn) => {

      for (const order of orders) {

        const {
          orderId,
          videoLink,
          quantity,
          seconds   // frontend se aa raha hai (but DB me duration hai)
        } = order;

        // ======================
        // VALIDATION
        // ======================
        if (
          !orderId ||
          !videoLink ||
          !quantity ||
          !seconds
        ) {
          failedOrders.push(orderId || "unknown");
          continue;
        }

        try {

          const originalQuantity = parseInt(quantity, 10);
          const durationValue = parseInt(seconds, 10);

          // remaining simple logic (no +15%)
          const remaining = originalQuantity;

          await conn.query(
            `INSERT INTO pending_orders
             (order_id, video_link, quantity, remaining, duration)
             VALUES (?, ?, ?, ?, ?)`,
            [
              orderId,
              videoLink,
              originalQuantity,
              remaining,
              durationValue
            ]
          );

          successOrders.push(orderId);

        } catch (err) {
          failedOrders.push(orderId || "db_error");
        }
      }
    });

    return res.json({
      success: true,
      message: "Orders processed",
      successCount: successOrders.length,
      failedCount: failedOrders.length,
      failedOrders,
      successOrders,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
});
//////////////////////

// add single order

router.post("/single-order",verifyAdminToken, async (req, res) => {

  const {
    orderId,
    videoLink,
    quantity,
    seconds
  } = req.body;

  if (!orderId || !videoLink || !quantity || !seconds) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  try {

    await db.withTransaction(async (conn) => {

      const originalQuantity = parseInt(quantity, 10);
      const durationValue = parseInt(seconds, 10);

      if (isNaN(originalQuantity) || isNaN(durationValue)) {
        throw new Error("Invalid quantity or duration");
      }

      const remaining = originalQuantity;

      await conn.query(
        `INSERT INTO pending_orders
        (order_id, video_link, quantity, remaining, duration)
        VALUES (?, ?, ?, ?, ?)`,
        [
          orderId,
          videoLink,
          originalQuantity,
          remaining,
          durationValue
        ]
      );
    });

    return res.json({
      success: true,
      message: "Order created successfully",
    });

  } catch (err) {

    console.log(err);

    return res.status(500).json({
      success: false,
      message: err.message || "Server Error",
    });
  }
});

// ======================================
// GET ORDERS
// ======================================

router.post("/demo-order", verifyAdminToken, async (req, res) => {

  const {
    orderId,
    videoLink,
    quantity,
    seconds
  } = req.body;

  if (!orderId || !videoLink || !quantity || !seconds) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  try {

    await db.withTransaction(async (conn) => {

      const originalQuantity = parseInt(quantity, 10);
      const durationValue = parseInt(seconds, 10);

      if (isNaN(originalQuantity) || isNaN(durationValue)) {
        throw new Error("Invalid quantity or duration");
      }

      const remaining = originalQuantity;

      // Same Single Order Insert
      await conn.query(
        `INSERT INTO pending_orders
        (order_id, video_link, quantity, remaining, duration)
        VALUES (?, ?, ?, ?, ?)`,
        [
          orderId,
          videoLink,
          originalQuantity,
          remaining,
          durationValue
        ]
      );

      // Skip Point Table Insert
      await conn.query(
        `INSERT INTO skip_point (order_id)
         VALUES (?)`,
        [orderId]
      );

    });

    return res.json({
      success: true,
      message: "Demo order created successfully",
    });

  } catch (err) {

    console.log(err);

    return res.status(500).json({
      success: false,
      message: err.message || "Server Error",
    });

  }
});
// ======================================
// GET ORDERS
// ======================================
router.get(
  "/get-orders",
  verifyAdminToken,
  (req, res) => getOrdersData(req, res, false)
);

router.get(
  "/search-orders",
  verifyAdminToken,
  (req, res) => getOrdersData(req, res, true)
);


router.post("/delete-multiple",verifyAdminToken, async (req, res) => {
  try {

    const { orders } = req.body;

    // =====================================
    // VALIDATION
    // =====================================
    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No orders selected",
      });
    }

    // =====================================
    // TABLES PRIORITY
    // =====================================
    const tables = [
      "pending_orders",
      "error_orders",
      "invalid_orders",
      "orders",
      "temp_orders",
      "complete_orders",
    ];

    // =====================================
    // DELETE LOOP
    // =====================================
    for (const item of orders) {

      const orderId = item?.order_id;

      if (!orderId) continue;

      let deleted = false;

      // =====================================
      // SMART TABLE SEARCH
      // =====================================
      for (const table of tables) {

        // check exists
        const exists = await db.queryAsync(
          `SELECT order_id FROM ${table} WHERE order_id = ? LIMIT 1`,
          [orderId]
        );

        // db overload protection
        if (exists === null) {
          return res.status(503).json({
            success: false,
            message: "Database busy, try again",
          });
        }

        // found
        if (exists.length > 0) {

          const del = await db.queryAsync(
            `DELETE FROM ${table} WHERE order_id = ?`,
            [orderId]
          );

          if (del === null) {
            return res.status(500).json({
              success: false,
              message: "Delete failed",
            });
          }

          deleted = true;

          console.log(`✅ Deleted ${orderId} from ${table}`);

          break;
        }
      }

      // optional log
      if (!deleted) {
        console.log(`⚠️ Order not found: ${orderId}`);
      }
    }

    // =====================================
    // SUCCESS RESPONSE
    // =====================================
    return res.json({
      success: true,
      message: "Orders deleted successfully",
    });

  } catch (err) {

    console.log("DELETE MULTIPLE ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Delete failed",
      error: err.message,
    });
  }
});

module.exports = router;






