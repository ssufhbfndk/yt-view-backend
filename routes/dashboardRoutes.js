const express = require("express");
const router = express.Router();

const { queryAsync } = require("../config/db");

// ======================================================
// DASHBOARD STATS API
// ======================================================
router.get("/stats", async (req, res) => {

  try {

    // ======================================================
    // 1. ACTIVE USERS (last 6 min activity)
    // ======================================================
    const activeUsersQuery = await queryAsync(`
      SELECT COUNT(*) as total
      FROM user
      WHERE token_created_at >= NOW() - INTERVAL 6 MINUTE
    `);

    // ======================================================
    // 2. PENDING ORDERS (temp + orders)
    // ======================================================
    const pendingTempOrders = await queryAsync(`
      SELECT COUNT(*) as total FROM temp_orders
    `);

    const pendingOrders = await queryAsync(`
      SELECT COUNT(*) as total FROM orders
    `);

    const totalPending =
      (pendingTempOrders?.[0]?.total || 0) +
      (pendingOrders?.[0]?.total || 0);

    // ======================================================
    // 3. COMPLETED ORDERS
    // ======================================================
    const completedOrdersQuery = await queryAsync(`
      SELECT COUNT(*) as total
      FROM complete_orders
    `);

    // ======================================================
    // 4. TOTAL REVENUE (ALL TIME)
    // ======================================================
    const revenueQuery = await queryAsync(`
  SELECT SUM(amount_pkr) as total
  FROM payment_history
  WHERE status = 1
`);

    // ======================================================
    // RESPONSE
    // ======================================================
    return res.json({
      success: true,

      activeUsers:
        activeUsersQuery?.[0]?.total || 0,

      pendingOrders: totalPending,

      completedOrders:
        completedOrdersQuery?.[0]?.total || 0,

      totalRevenue:
        revenueQuery?.[0]?.total || 0,
    });

  } catch (err) {

    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });

  }

});
module.exports = router;