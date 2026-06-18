const express = require('express');
const router = express.Router();
const db = require('../config/db');  // Assuming db.js is where your MySQL connection is set up
const {verifyAdminToken} = require("../middleware/authMiddleware");

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
           (order_id, video_link, quantity, channel_name, timestamp)
           VALUES (?, ?, ?, ?, NOW())`,
          [order.order_id, order.video_link, order.quantity, order.channel_name]
        );

        await conn.query(
          `DELETE FROM orders WHERE order_id = ?`,
          [order.order_id]
        );

      } else {

        const delayPool = [5,15,30,45,60,75,90,120,150,180,210,240,270,300];
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
// ======================================
// GET ORDERS
// ======================================
router.get("/get-orders",verifyAdminToken, async (req, res) => {

  try {

    const {
      page,
      limit,
      search,
      status,
    } = req.query;

    // ================================
    // VALIDATION
    // ================================
    if (
      page === undefined ||
      limit === undefined ||
      search === undefined ||
      status === undefined
    ) {

      return res.status(400).json({
        message: "page, limit, search, status required",
      });

    }

    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (
      isNaN(pageNum) ||
      isNaN(limitNum)
    ) {

      return res.status(400).json({
        message: "Invalid page or limit",
      });

    }

    const offset =
      (pageNum - 1) * limitNum;

    // ================================
    // DYNAMIC QUERY
    // ================================
    let query = "";
    let countQuery = "";

    // =================================
    // ALL
    // =================================
    if (status === "all") {

      query = `
SELECT * FROM (

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    'Unavailable' AS type,
    'pending' AS status
  FROM pending_orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    reason,
    'Unavailable' AS type,
    'errors' AS status
  FROM error_orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
   error_reason AS reason,
    'Unavailable' AS type,
    'invalid' AS status
  FROM invalid_orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    type,
    'process' AS status
  FROM orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    type,
    'process' AS status
  FROM temp_orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    0 AS remaining,
    'Valid' AS reason,
    type,
    'complete' AS status
  FROM complete_orders

) AS all_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)

ORDER BY order_id DESC

LIMIT ${limitNum}
OFFSET ${offset}
`;

      countQuery = `
SELECT COUNT(*) AS total FROM (

  SELECT order_id FROM pending_orders
  UNION ALL
  SELECT order_id FROM error_orders
  UNION ALL
  SELECT order_id FROM invalid_orders
  UNION ALL
  SELECT order_id FROM orders
  UNION ALL
  SELECT order_id FROM temp_orders
  UNION ALL
  SELECT order_id FROM complete_orders

) AS total_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)
`;

    }

    // =================================
    // PENDING
    // =================================
    else if (status === "pending") {

      query = `
SELECT
  order_id,
  video_link,
  quantity,
  duration,
  remaining,
  'Valid' AS reason,
  'Unavailable' AS type,
  'pending' AS status
FROM pending_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)

ORDER BY order_id DESC

LIMIT ${limitNum}
OFFSET ${offset}
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM pending_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)
`;

    }

    // =================================
    // INVALID
    // =================================
    else if (status === "invalid") {

      query = `
SELECT
  order_id,
  video_link,
  quantity,
  duration,
  remaining,
  error_reason AS reason,
  'Unavailable' AS type,
  'invalid' AS status
FROM invalid_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)

ORDER BY order_id DESC

LIMIT ${limitNum}
OFFSET ${offset}
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM invalid_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)
`;

    }

    // =================================
    // ERRORS
    // =================================
    else if (status === "errors") {

      query = `
SELECT
  order_id,
  video_link,
  quantity,
  duration,
  remaining,
  reason,
  'Unavailable' AS type,
  'errors' AS status
FROM error_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)

ORDER BY order_id DESC

LIMIT ${limitNum}
OFFSET ${offset}
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM error_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)
`;

    }

    // =================================
    // PROCESS
    // =================================
    else if (status === "process") {

      query = `
SELECT * FROM (

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    type,
    'process' AS status
  FROM orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    type,
    'process' AS status
  FROM temp_orders

) AS process_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)

ORDER BY order_id DESC

LIMIT ${limitNum}
OFFSET ${offset}
`;

      countQuery = `
SELECT COUNT(*) AS total FROM (

  SELECT order_id FROM orders

  UNION ALL

  SELECT order_id FROM temp_orders

) AS total_process

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)
`;

    }

    // =================================
    // COMPLETE
    // =================================
    else if (status === "complete") {

      query = `
SELECT
  order_id,
  video_link,
  quantity,
  duration,
  0 AS remaining,
  'Valid' AS reason,
  type,
  'complete' AS status
FROM complete_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)

ORDER BY order_id DESC

LIMIT ${limitNum}
OFFSET ${offset}
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM complete_orders

WHERE (
  '${search}' = ''
  OR order_id LIKE '%${search}%'
)
`;

    }

    // =================================
    // INVALID STATUS
    // =================================
    else {

      return res.status(400).json({
        message: "Invalid status",
      });

    }

    // ================================
    // DB QUERY
    // ================================
    const orders =
      await db.queryAsync(query);

    const totalResult =
      await db.queryAsync(countQuery);

    const total =
      totalResult[0]?.total || 0;

    const totalPages =
      Math.ceil(total / limitNum) || 1;

    // ================================
    // RESPONSE
    // ================================
    return res.json({
      orders,
      totalPages,
      total,
      currentPage: pageNum,
    });

  } catch (err) {

    console.log(err);

    return res.status(500).json({
      message: "Failed to fetch orders",
    });

  }

});

router.get("/search-orders",verifyAdminToken, async (req, res) => {
  try {
    const {
      page,
      limit,
      search = "",
      status,
    } = req.query;

    // =========================================
    // VALIDATION
    // =========================================
    if (
      page === undefined ||
      limit === undefined ||
      status === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "page, limit, status required",
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    if (
      isNaN(pageNum) ||
      isNaN(limitNum) ||
      pageNum < 1 ||
      limitNum < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid page or limit",
      });
    }

    const offset = (pageNum - 1) * limitNum;

    // =========================================
    // SAFE SEARCH
    // =========================================
    const searchValue = search.trim();
    const isNumberSearch = /^\d+$/.test(searchValue);

    let searchCondition = "1=1";

    if (searchValue !== "") {
      if (isNumberSearch) {
        searchCondition = `CAST(order_id AS CHAR) LIKE ?`;
      } else {
        searchCondition = `video_link LIKE ?`;
      }
    }

    const searchParams =
      searchValue !== ""
        ? [`%${searchValue}%`]
        : [];

    // =========================================
    // QUERY VARIABLES
    // =========================================
    let query = "";
    let countQuery = "";

    // =========================================
    // ALL
    // =========================================
    if (status === "all") {

      query = `
SELECT * FROM (

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    'Unavailable' AS type,
    'pending' AS status
  FROM pending_orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    reason,
    'Unavailable' AS type,
    'errors' AS status
  FROM error_orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    error_reason AS reason,
    'Unavailable' AS type,
    'invalid' AS status
  FROM invalid_orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    type,
    'process' AS status
  FROM orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    type,
    'process' AS status
  FROM temp_orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    0 AS remaining,
    'Valid' AS reason,
    type,
    'complete' AS status
  FROM complete_orders

) AS all_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total FROM (

  SELECT order_id, video_link FROM pending_orders
  UNION ALL
  SELECT order_id, video_link FROM error_orders
  UNION ALL
  SELECT order_id, video_link FROM invalid_orders
  UNION ALL
  SELECT order_id, video_link FROM orders
  UNION ALL
  SELECT order_id, video_link FROM temp_orders
  UNION ALL
  SELECT order_id, video_link FROM complete_orders

) AS all_count

WHERE ${searchCondition}
`;
    }

    // =========================================
    // PENDING
    // =========================================
    else if (status === "pending") {

      query = `
SELECT
  order_id,
  video_link,
  quantity,
  duration,
  remaining,
  'Valid' AS reason,
  'Unavailable' AS type,
  'pending' AS status
FROM pending_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM pending_orders
WHERE ${searchCondition}
`;
    }

    // =========================================
    // INVALID
    // =========================================
    else if (status === "invalid") {

      query = `
SELECT
  order_id,
  video_link,
  quantity,
  duration,
  remaining,
  error_reason AS reason,
  'Unavailable' AS type,
  'invalid' AS status
FROM invalid_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM invalid_orders
WHERE ${searchCondition}
`;
    }

    // =========================================
    // ERRORS
    // =========================================
    else if (status === "errors") {

      query = `
SELECT
  order_id,
  video_link,
  quantity,
  duration,
  remaining,
  reason,
  'Unavailable' AS type,
  'errors' AS status
FROM error_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM error_orders
WHERE ${searchCondition}
`;
    }

    // =========================================
    // PROCESS
    // =========================================
    else if (status === "process") {

      query = `
SELECT * FROM (

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    type,
    'process' AS status
  FROM orders

  UNION ALL

  SELECT
    order_id,
    video_link,
    quantity,
    duration,
    remaining,
    'Valid' AS reason,
    type,
    'process' AS status
  FROM temp_orders

) AS process_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total FROM (

  SELECT order_id, video_link FROM orders
  UNION ALL
  SELECT order_id, video_link FROM temp_orders

) AS process_count

WHERE ${searchCondition}
`;
    }

    // =========================================
    // COMPLETE
    // =========================================
    else if (status === "complete") {

      query = `
SELECT
  order_id,
  video_link,
  quantity,
  duration,
  0 AS remaining,
  'Valid' AS reason,
  type,
  'complete' AS status
FROM complete_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM complete_orders
WHERE ${searchCondition}
`;
    }

    // =========================================
    // INVALID STATUS
    // =========================================
    else {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    // =========================================
    // EXECUTE QUERIES
    // =========================================
    const orders = await db.queryAsync(
      query,
      [...searchParams, limitNum, offset]
    );

    const totalResult = await db.queryAsync(
      countQuery,
      searchParams
    );

    const total = totalResult?.[0]?.total || 0;

    const totalPages =
      total > 0
        ? Math.ceil(total / limitNum)
        : 1;

    // =========================================
    // RESPONSE
    // =========================================
    return res.json({
      success: true,
      orders,
      total,
      totalPages,
      currentPage: pageNum,
    });

  } catch (err) {
    console.log("SEARCH ORDER ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Search failed",
      error: err.message,
    });
  }
});


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






