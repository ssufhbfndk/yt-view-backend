const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const { queryAsync } = require("../config/db");
const {verifyAdminToken} = require("../middleware/authMiddleware");
const { getTransactionsData } = require("../controllers/adminFunctionsController");
// ================================
// GET TRANSACTIONS VIEW API
// ================================
router.get("/transactions-view",verifyAdminToken,(req, res) => getTransactionsData(req, res, false)
);

router.get("/transactions-search", verifyAdminToken,(req, res) => getTransactionsData(req, res, true)
);
// ================================
// UPDATE TRANSACTION STATUS API
// ================================
router.put( "/update-transaction-status", verifyAdminToken, async (req, res) => {
    try {
      const {
        transaction_id,
        status,
        invoice_number,
        
      } = req.body;

      // =====================
      // VALIDATION
      // =====================
      if (!transaction_id) {
        return res.status(400).json({
          success: false,
          message: "Transaction ID required"
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
          message: "Transaction not found"
        });
      }

      const transaction = rows[0];


      const currentStatus = Number(transaction.status);
      // =====================
// SAME STATUS BLOCK
// =====================
if (currentStatus === Number(status)) {
  return res.status(400).json({
    success: false,
    message: "Transaction already has this status"
  });
}
      // =====================
      // LOCK COMPLETED/REJECTED
      // =====================
    

      if (currentStatus === 1 || currentStatus === 2) {
        return res.status(400).json({
          success: false,
          message: "Transaction already finalized"
        });
      }

      // =====================
      // COMPLETED VALIDATION
      // =====================
      if (Number(status) === 1) {
        if (!invoice_number?.trim()) {
          return res.status(400).json({
            success: false,
            message: "Invoice number required"
          });
        }
      }

      

      // =====================
      // UPDATE TRANSACTION
      // =====================
      await queryAsync(
        `
        UPDATE payment_history
        SET
          status = ?,
          invoice_num = ?,
          status_updated_at = NOW()
        WHERE id = ?
        `,
        [
          status,
          Number(status) === 1
            ? invoice_number.trim()
            : null,
          transaction_id
        ]
      );

      // =====================
      // REJECT => RETURN COINS
      // =====================
      if (Number(status) === 2) {

       await queryAsync(
  `
  UPDATE user
  SET num_views = num_views + ?
  WHERE username = ?
  `,
  [
    Number(transaction.coins),
    transaction.username
  ]
);
      }

      // =====================
      // NOTIFICATION MESSAGE
      // =====================
      let notiTitle = "";
      let notiBody = "";

      if (Number(status) === 1) {

        notiTitle = "Payment Approved";

        notiBody =
`Your withdrawal request has been approved.

Amount Sent: Rs ${transaction.amount_pkr}

Invoice Number: ${invoice_number}`;

      } else if (Number(status) === 2) {

        notiTitle = "Payment Rejected";

        notiBody =
`Your withdrawal request has been rejected.

Reason: account detail invalid


${transaction.coins} coins have been returned to your account.`;

      }

      // =====================
      // SEND FCM
      // =====================
      if (
        transaction.fcm_token &&
        transaction.fcm_token.trim() !== ""
      ) {
        try {

          await admin.messaging().send({
            token: transaction.fcm_token,
            data: {
              title: notiTitle,
              body: notiBody,
              link: ""
            }
          });

        } catch (fcmError) {
          console.log("FCM ERROR:", fcmError);
        }
      }

      return res.json({
        success: true,
        message: "Transaction updated successfully"
      });

    } catch (error) {

      console.log(error);

      return res.status(500).json({
        success: false,
        message: "Server error"
      });
    }
  }
);


router.get("/payment-management", verifyAdminToken, async (req, res) => {
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

router.put("/update-payment-management",verifyAdminToken, async (req, res) => {
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



router.get("/view-payment-management",verifyAdminToken, async (req, res) => {
  try {

    // =========================
    // SINGLE QUERY: ALL DATA
    // =========================
    const rows = await queryAsync(`
      SELECT 
        amount_pkr,
        status,
        created_at
      FROM payment_history
    `);

    // =========================
    // ADMIN BALANCE
    // =========================
    const adminRows = await queryAsync(`
      SELECT admin_balance
      FROM payout_settings
      LIMIT 1
    `);

    const adminBalance = Number(adminRows?.[0]?.admin_balance || 0);

    // =========================
    // INITIAL VALUES
    // =========================
    let today = 0;
    let week = 0;
    let month = 0;
    let year = 0;

    let pending = 0;
    let rejected = 0;
    let completedTotal = 0;

    const now = new Date();

    // =========================
    // PROCESS DATA IN JS
    // =========================
    rows.forEach((item) => {

      const amount = Number(item.amount_pkr || 0);
      const status = Number(item.status);
      const date = new Date(item.created_at);

      // =====================
      // STATUS CALC
      // =====================
      if (status === 1) {
        completedTotal += amount;

        // TODAY
        if (date.toDateString() === now.toDateString()) {
          today += amount;
        }

        // WEEK (7 days)
        const diffDays = (now - date) / (1000 * 60 * 60 * 24);
        if (diffDays <= 7) {
          week += amount;
        }

        // MONTH (30 days)
        if (diffDays <= 30) {
          month += amount;
        }

        // YEAR (365 days)
        if (diffDays <= 365) {
          year += amount;
        }
      }

      // =====================
      // PENDING
      // =====================
      if (status === 0) {
        pending += amount;
      }

      // =====================
      // REJECTED
      // =====================
      if (status === 2) {
        rejected += amount;
      }

    });

    // =========================
    // RESPONSE
    // =========================
    return res.json({
      success: true,

      todayPayments: today,
      weekPayments: week,
      monthPayments: month,
      yearPayments: year,

      pendingPayments: pending,
      rejectedPayments: rejected,

      adminBalance,
      completedPayments: completedTotal
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// 📌 GET WALLET DATA (WITH USERNAME)
router.get("/wallet-data/:username", async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Username required"
    });
  }

  try {

    const userRows = await db.queryAsync(
      "SELECT num_views FROM user WHERE username = ? LIMIT 1",
      [username]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const settingsRows = await db.queryAsync(
      "SELECT client_rate, dollar_rate FROM payout_settings LIMIT 1"
    );

    if (!settingsRows || settingsRows.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Payout settings missing"
      });
    }

    const coins = Number(userRows[0].num_views) || 0;
    const client_rate = (Number(settingsRows[0].client_rate) || 0) / 1000;
    const dollar_rate = Number(settingsRows[0].dollar_rate) || 0;

    return res.json({
      success: true,
      coins,
      client_rate,
      dollar_rate
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// withdraw-payment

router.post("/withdraw-payment", async (req, res) => {
  const {
    username,
    bank_name,
    account_holder_name,
    account,
    coins,
    usd,
    pkr
  } = req.body;

  if (!username || !account || !coins) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields"
    });
  }

  try {

    const result = await db.withTransaction(async (conn) => {

      // =========================
      // USER CHECK + LOCK
      // =========================
      const [userResult] = await conn.query(
        "SELECT num_views FROM user WHERE username = ? FOR UPDATE",
        [username]
      );

      if (userResult.length === 0) {
        return { error: "USER_NOT_FOUND" };
      }

      const numViews = userResult[0].num_views;

      // =========================
      // BALANCE CHECK
      // =========================
      if (numViews < coins) {
        return { error: "INSUFFICIENT" };
      }

      const updatedViews = numViews - coins;

      // =========================
      // UPDATE USER BALANCE
      // =========================
      await conn.query(
        "UPDATE user SET num_views = ? WHERE username = ?",
        [updatedViews, username]
      );

      const safeUsd = usd ?? 0;
      const safePkr = pkr ?? 0;

      // =========================
      // SAVE PAYMENT HISTORY
      // =========================
      const [insertResult] = await conn.query(
        `INSERT INTO payment_history
        (username, bank_name, bank_account_number, account_holder_name, coins, amount_pkr, amount_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          username,
          bank_name,
          account,
          account_holder_name,
          coins,
          safePkr,
          safeUsd
        ]
      );

      return {
        success: true,
        updatedViews,
        paymentId: insertResult.insertId
      };

    });

    // =========================
    // ERROR HANDLING
    // =========================
    if (!result) {
      return res.status(500).json({
        success: false,
        message: "Server error"
      });
    }

    if (result.error === "USER_NOT_FOUND") {
      return res.json({
        success: false,
        message: "User not found"
      });
    }

    if (result.error === "INSUFFICIENT") {
      return res.json({
        success: false,
        message: "Insufficient balance"
      });
    }

    // =========================
    // ADMIN NOTIFICATION DB (OUTSIDE TRANSACTION)
    // =========================
    await db.queryAsync(
  `INSERT INTO admin_notifications
  (title, message, type, reference_id, is_read)
  VALUES (?, ?, ?, ?, 0)`,
  [
    "New Withdrawal Request",
    `${username} requested withdrawal of ${pkr} pkr`,
    "withdraw",
    result.paymentId
  ]
);

    // =========================
    // SOCKET NOTIFICATION
    // =========================
   const ioInstance = socket.getIO();

if (ioInstance) {
  ioInstance.emit("admin_notification", {
    title: "New Withdrawal Request",
    message: `${username} requested withdrawal`,
    type: "withdraw",
    reference_id: result.paymentId
  });
}
// =========================
// FIREBASE PUSH (ALL ADMINS)
// =========================
// =========================
// FIREBASE PUSH (ALL ADMINS)
// =========================
const resultTokens = await db.queryAsync(
  `SELECT DISTINCT fcm_token
   FROM admin_fcm_tokens
   WHERE fcm_token IS NOT NULL`
);

await Promise.all(
  resultTokens.map(async (row) => {

    if (!row.fcm_token) return;

    try {

      await admin.messaging().send({
        token: row.fcm_token,

        notification: {
          title: "New Withdrawal Request",
          body: `${username} requested withdrawal of ${pkr} PKR`
        },

        webpush: {
          notification: {
            icon: "https://ythub.lat/logo192.png"
          }
        }

      });

    } catch (err) {

      console.error(
        "Push failed:",
        err.message
      );

      // Invalid token auto delete
      if (
        err.code ===
        "messaging/registration-token-not-registered"
      ) {

        await db.queryAsync(
          `DELETE FROM admin_fcm_tokens
           WHERE fcm_token = ?`,
          [row.fcm_token]
        );

        console.log(
          "Invalid token removed:",
          row.fcm_token
        );
      }

    }

  })
);
    // =========================
    // RESPONSE
    // =========================
    return res.json({
      success: true,
      message: "Withdraw successful",
      num_views: result.updatedViews,
      payment_id: result.paymentId
    });

  } catch (err) {

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });

  }
});

//payment history

router.get("/payment-history/:username", async (req, res) => {

  const { username } = req.params;

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Username required"
    });
  }

  try {

    const rows = await db.queryAsync(
      `SELECT 
        id,
        bank_name,
        account_holder_name,
        bank_account_number AS account,
        coins,
        amount_usd,
        amount_pkr,
        status,
        created_at
      FROM payment_history
      WHERE username = ?
      ORDER BY id DESC`,
      [username]
    );

    return res.json(rows || []);

  } catch (err) {

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});
module.exports = router;