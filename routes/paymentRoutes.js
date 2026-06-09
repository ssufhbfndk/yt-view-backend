const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const { queryAsync } = require("../config/db");

// ================================
// GET TRANSACTIONS VIEW API
// ================================
router.get("/transactions-view", async (req, res) => {
  try {

    let { page, limit, status } = req.query;

    if (!page || !limit) {
      return res.status(400).json({
        success: false,
        message: "page and limit required"
      });
    }

    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    // ================================
    // STATUS FILTER (IMPORTANT FIX)
    // ================================
    if (status !== undefined && status !== "all") {

      // frontend string safety fix
      const statusMap = {
        pending: 0,
        completed: 1,
        rejected: 2,
        0: 0,
        1: 1,
        2: 2
      };

      const statusValue = statusMap[status];

      if (statusValue !== undefined) {
        where.push("status = ?");
        params.push(statusValue);
      }
    }

    const whereSQL = where.length
      ? "WHERE " + where.join(" AND ")
      : "";

    const sql = `
      SELECT 
        id ,
        username,
        bank_name,
        bank_account_number,
        account_holder_name,
        coins,
        amount_pkr,
        amount_usd,
        status,
        invoice_num,
        created_at,
        status_updated_at
      FROM payment_history
      ${whereSQL}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;

    const transactions = await queryAsync(sql, [
      ...params,
      limit,
      offset
    ]);

    const countSQL = `
      SELECT COUNT(*) as total
      FROM payment_history
      ${whereSQL}
    `;

    const countResult = await queryAsync(countSQL, params);

    return res.json({
      success: true,
      transactions,
      total: countResult?.[0]?.total || 0,
      totalPages: Math.ceil((countResult?.[0]?.total || 0) / limit),
      page
    });

  } catch (err) {
    console.log(err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});
// ================================
// SEARCH TRANSACTIONS
// ================================
router.get("/transactions-search", async (req, res) => {
  try {

    let { page, limit, search, status } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);
    search = search ? String(search).trim() : "";

    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    // ================================
    // SEARCH
    // ================================
    if (search) {
      where.push(`(
        username LIKE ?
        OR CAST(id AS CHAR) LIKE ?
      )`);

      params.push(`%${search}%`, `%${search}%`);
    }

    // ================================
    // STATUS FIX (SAME LOGIC)
    // ================================
    if (status !== undefined && status !== "all") {

      const statusMap = {
        pending: 0,
        completed: 1,
        rejected: 2,
        0: 0,
        1: 1,
        2: 2
      };

      const statusValue = statusMap[status];

      if (statusValue !== undefined) {
        where.push("status = ?");
        params.push(statusValue);
      }
    }

    const whereSQL = where.length
      ? "WHERE " + where.join(" AND ")
      : "";

    const sql = `
      SELECT 
        id,
        username,
        bank_name,
        bank_account_number,
        account_holder_name,
        coins,
        amount_pkr,
        amount_usd,
        status,
        invoice_num,
        created_at,
        status_updated_at
      FROM payment_history
      ${whereSQL}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;

    const transactions = await queryAsync(sql, [
      ...params,
      limit,
      offset
    ]);

    const countSQL = `
      SELECT COUNT(*) as total
      FROM payment_history
      ${whereSQL}
    `;

    const countResult = await queryAsync(countSQL, params);

    return res.json({
      success: true,
      transactions,
      total: countResult?.[0]?.total || 0,
      totalPages: Math.ceil((countResult?.[0]?.total || 0) / limit),
      page
    });

  } catch (err) {
    console.log(err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// ================================
// UPDATE TRANSACTION STATUS API
// ================================
router.put("/update-transaction-status", async (req, res) => {

  try {

    const {
      transaction_id,
      status,
      invoice_number
    } = req.body;

    // =====================
    // VALIDATION
    // =====================
    if (!transaction_id) {

      return res.status(400).json({

        success: false,

        message:
          "Transaction ID required",
      });
    }

    if (
      status === undefined
      ||
      status === null
    ) {

      return res.status(400).json({

        success: false,

        message:
          "Status required",
      });
    }

    // =====================
    // GET TRANSACTION
    // =====================
    const rows = await queryAsync(
      `
      SELECT
        payment_history.*,
        user.fcm_token,
        user.username
      FROM payment_history
      LEFT JOIN user
      ON payment_history.username = user.username
      WHERE payment_history.id = ?
      `,
      [transaction_id]
    );

    if (!rows || rows.length === 0) {

      return res.status(404).json({

        success: false,

        message:
          "Transaction not found",
      });
    }

    const transaction =
      rows[0];

    // =====================
    // BUSINESS LOGIC
    // =====================
    let finalInvoice = null;

    if (Number(status) === 1) {

      if (
        !invoice_number
        ||
        invoice_number.trim() === ""
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Invoice number required for completed status",
        });
      }

      finalInvoice =
        invoice_number.trim();
    }

    const status_updated_at =
      new Date();

    // =====================
    // UPDATE QUERY
    // =====================
    const result =
      await queryAsync(
        `
        UPDATE payment_history
        SET
          status = ?,
          invoice_num = ?,
          status_updated_at = ?
        WHERE id = ?
        `,
        [
          status,
          finalInvoice,
          status_updated_at,
          transaction_id
        ]
      );

    if (!result) {

      return res.status(500).json({

        success: false,

        message:
          "Database update failed",
      });
    }

    // =====================
    // NOTIFICATION MESSAGE
    // =====================
    let notiTitle =
      "Transaction Update";

    let notiBody =
      "Your transaction status updated.";

    // ✅ COMPLETED
    if (Number(status) === 1) {

      notiTitle =
        "Payment Completed";

      notiBody =
        `Invoice: ${finalInvoice}`;
    }

    // ✅ PENDING
    else if (Number(status) === 0) {

      notiTitle =
        "Payment Pending";

      notiBody =
        "Your payment is pending.";
    }

    // ✅ REJECTED
    else if (Number(status) === 2) {

      notiTitle =
        "Payment Rejected";

      notiBody =
        "Your payment was rejected.";
    }

    // =====================
    // SEND FCM
    // =====================
    if (
      transaction.fcm_token
      &&
      transaction.fcm_token.trim() !== ""
    ) {

      try {

        await admin
          .messaging()
          .send({

            token:
              transaction.fcm_token,

            data: {

              title: notiTitle,

              body: notiBody,

              link: ""
            }
          });

      } catch (fcmError) {

        console.log(
          "FCM ERROR:",
          fcmError
        );
      }
    }

    // =====================
    // SUCCESS RESPONSE
    // =====================
    return res.json({

      success: true,

      message:
        "Transaction updated successfully",
    });

  } catch (error) {

    console.error(
      "❌ API ERROR:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Server error",
    });
  }
});



router.get("/payment-management", async (req, res) => {
  try {

    const rows = await queryAsync(
      "SELECT client_rate, dollar_rate, admin_balance FROM payout_settings LIMIT 1"
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payout settings not found"
      });
    }

    const settings = rows[0];

    return res.json({
      success: true,
      clientRate: Number(settings.client_rate) || 0,
      dollarRate: Number(settings.dollar_rate) || 0,
      adminDebit: Number(settings.admin_debit) || 0
    });

  } catch (error) {
    console.error("payment-management error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

router.put("/update-payment-management", async (req, res) => {
  try {
    const { type, value } = req.body;

    if (!type || value === undefined || value === null) {
      return res.status(400).json({
        success: false,
        message: "Type and value are required"
      });
    }

    const numericValue = Number(value);

    if (isNaN(numericValue) || numericValue < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid value"
      });
    }

    // ==========================
    // ADMIN BALANCE UPDATE
    // ==========================
    if (type === "adminDebit") {

      const rows = await queryAsync(
        "SELECT admin_balance FROM payout_settings LIMIT 1"
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Payout settings not found"
        });
      }

      const currentBalance = Number(rows[0].admin_balance) || 0;

      const updatedBalance = currentBalance + numericValue;

      await queryAsync(
        "UPDATE payout_settings SET admin_balance = ?",
        [updatedBalance]
      );

      return res.json({
        success: true,
        message: "Admin balance updated successfully",
        old_balance: currentBalance,
        added_amount: numericValue,
        new_balance: updatedBalance
      });
    }

    // ==========================
    // CLIENT RATE UPDATE
    // ==========================
    if (type === "clientRate") {

      await queryAsync(
        "UPDATE payout_settings SET client_rate = ?",
        [numericValue]
      );

      return res.json({
        success: true,
        message: "Client rate updated successfully",
        client_rate: numericValue
      });
    }

    // ==========================
    // DOLLAR RATE UPDATE
    // ==========================
    if (type === "dollarRate") {

      await queryAsync(
        "UPDATE payout_settings SET dollar_rate = ?",
        [numericValue]
      );

      return res.json({
        success: true,
        message: "Dollar rate updated successfully",
        dollar_rate: numericValue
      });
    }

    // ==========================
    // INVALID TYPE
    // ==========================
    return res.status(400).json({
      success: false,
      message: "Invalid update type"
    });

  } catch (error) {

    console.error("update-payment-management error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

router.get("/view-payment-management", async (req, res) => {
  try {

    // =========================
    // TODAY (completed only)
    // =========================
    const todayRows = await queryAsync(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_history
      WHERE DATE(created_at) = CURDATE()
      AND status = 1
    `);

    // =========================
    // LAST 7 DAYS
    // =========================
    const weekRows = await queryAsync(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_history
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND status = 1
    `);

    // =========================
    // LAST 30 DAYS
    // =========================
    const monthRows = await queryAsync(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_history
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      AND status = 1
    `);

    // =========================
    // YEAR
    // =========================
    const yearRows = await queryAsync(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_history
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR)
      AND status = 1
    `);

    // =========================
    // PENDING (status = 0)
    // =========================
    const pendingRows = await queryAsync(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_history
      WHERE status = 0
    `);

    // =========================
    // REJECTED (optional tracking)
    // =========================
    const rejectedRows = await queryAsync(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_history
      WHERE status = 2
    `);

    // =========================
    // ADMIN BALANCE
    // =========================
    const adminRows = await queryAsync(`
      SELECT admin_balance
      FROM payout_settings
      LIMIT 1
    `);

    // =========================
    // VALUES
    // =========================
    const todayPayments = Number(todayRows?.[0]?.total || 0);
    const weekPayments = Number(weekRows?.[0]?.total || 0);
    const monthPayments = Number(monthRows?.[0]?.total || 0);
    const yearPayments = Number(yearRows?.[0]?.total || 0);

    const pendingPayments = Number(pendingRows?.[0]?.total || 0);
    const rejectedPayments = Number(rejectedRows?.[0]?.total || 0);

    const adminBalance = Number(adminRows?.[0]?.admin_balance || 0);

    // =========================
    // RESPONSE
    // =========================
    return res.json({
      success: true,
      todayPayments,
      weekPayments,
      monthPayments,
      yearPayments,
      pendingPayments,
      rejectedPayments,
      adminBalance
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});
module.exports = router;