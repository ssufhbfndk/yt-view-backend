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

    const rows = await db.queryAsync(
      "SELECT client_rate, dollar_rate, admin_balance FROM payout_settings LIMIT 1"
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payout settings not found"
      });
    }

    const data = rows[0];

    return res.json({
      success: true,
      clientRate: Number(data.client_rate) || 0,
      dollarRate: Number(data.dollar_rate) || 0,
      adminDebit: Number(data.admin_debit) || 0
    });

  } catch (error) {
    console.error("Payment settings error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

module.exports = router;