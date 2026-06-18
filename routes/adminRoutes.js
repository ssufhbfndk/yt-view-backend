const express = require("express");
const db = require("../config/db");
const { login, logout, checkAdminSession,changePassword ,sendBroadcastNotification} = require("../controllers/adminController");
const { verifyAdminToken } = require("../middleware/authMiddleware");
const socket = require("../socket");
const router = express.Router();
const admin = require("../firebaseAdmin");
router.post("/login", login);
router.post("/logout", logout);
router.get("/check-session", verifyAdminToken, checkAdminSession);
router.put(
  "/change-password",
  verifyAdminToken,
  changePassword
);

router.post(
    "/broadcast-notification",verifyAdminToken,sendBroadcastNotification
);


// ============================
// GET ADMIN NOTIFICATIONS
// ============================
router.get("/notifications",async (req, res) => {
    try {

      const rows = await db.queryAsync(
        `SELECT *
         FROM admin_notifications
         ORDER BY id DESC
         LIMIT 20`
      );

      res.json({
        success: true,
        notifications: rows
      });

    } catch (err) {

      res.status(500).json({
        success: false,
        message: "Server error"
      });

    }
  }
);

router.post("/open-notification", async (req, res) => {
    try {
      const { notification_id } = req.body;
      const notification = await db.queryAsync(
        `SELECT *
         FROM admin_notifications
         WHERE id = ?
         LIMIT 1`,
        [notification_id]
      );

      if (!notification.length) {
        return res.status(404).json({
          success: false,
          message: "Notification not found"
        });
      }

      const referenceId =
        notification[0].reference_id;

      const payment = await db.queryAsync(
        `SELECT *
         FROM payment_history
         WHERE id = ?
         LIMIT 1`,
        [referenceId]
      );

      await db.queryAsync(
        `DELETE FROM admin_notifications
         WHERE id = ?`,
        [notification_id]
      );

      return res.json({
        success: true,
        payment: payment[0]
      });

    } catch (err) {

      return res.status(500).json({
        success: false,
        message: "Server error"
      });

    }

  }
);
router.get("/notification-count", async (req, res) => {
  try {

    const rows = await db.queryAsync(`
      SELECT COUNT(*) AS count
      FROM admin_notifications
    `);

    res.json({
      success: true,
      count: rows[0].count || 0
    });

  } catch (error) {

    console.error("notification-count:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
});

router.post("/test-notification", async (req, res) => {

  try {

    const {
      title,
      message,
      type,
      reference_id
    } = req.body;

    // =========================
    // 1. SOCKET NOTIFICATION
    // =========================
    const ioInstance = socket.getIO();

    if (ioInstance) {
      ioInstance.emit("admin_notification", {
        title,
        message,
        type,
        reference_id
      });
    }

    // =========================
    // 2. FIREBASE PUSH (ALL ADMINS)
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
          title,
          body: message
        },

        webpush: {
          notification: {
            icon: "https://ythub.lat/logo192.png"
          }
        }

      });

    } catch (err) {

      console.log(
        "FCM failed:",
        err.message
      );

      // invalid token auto remove
      if (
        err.code ===
        "messaging/registration-token-not-registered"
      ) {

        await db.queryAsync(
          `DELETE FROM admin_fcm_tokens
           WHERE fcm_token = ?`,
          [row.fcm_token]
        );

      }

    }

  })
);

    return res.status(200).json({
      success: true,
      message: "Socket + FCM notification sent successfully"
    });

  } catch (error) {

    console.error("Notification Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to send notification"
    });

  }
});

router.post("/save-web-token", async (req, res) => {

  try {

    const {
      adminId,
      oldToken,
      newToken
    } = req.body;

    if (!adminId || !newToken) {

      return res.status(400).json({
        success: false,
        message: "adminId and token required"
      });

    }

    // remove old inactive tokens
    await db.queryAsync(
      `DELETE FROM admin_fcm_tokens
       WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    let updated = false;

    // old token mila to update
    if (oldToken) {

      const rows = await db.queryAsync(
        `SELECT id
         FROM admin_fcm_tokens
         WHERE admin_id = ?
         AND fcm_token = ?
         LIMIT 1`,
        [adminId, oldToken]
      );

      if (rows.length > 0) {

        await db.queryAsync(
          `UPDATE admin_fcm_tokens
           SET fcm_token = ?,
               created_at = NOW()
           WHERE id = ?`,
          [
            newToken,
            rows[0].id
          ]
        );

        updated = true;

      }

    }

    // old token nahi mila
    if (!updated) {

      const existing =
        await db.queryAsync(
          `SELECT id
           FROM admin_fcm_tokens
           WHERE admin_id = ?
           AND fcm_token = ?
           LIMIT 1`,
          [adminId, newToken]
        );

      if (existing.length === 0) {

        await db.queryAsync(
          `INSERT INTO admin_fcm_tokens
          (
            admin_id,
            fcm_token
          )
          VALUES (?, ?)`,
          [
            adminId,
            newToken
          ]
        );

      } else {

        await db.queryAsync(
          `UPDATE admin_fcm_tokens
           SET created_at = NOW()
           WHERE id = ?`,
          [existing[0].id]
        );

      }

    }

    return res.json({
      success: true,
      message: "Token saved"
    });

  } catch (error) {

    console.error(
      "save-web-token error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Server error"
    });

  }

});
module.exports = router;
