const express = require("express");
const db = require("../config/db");
const { login, logout, checkAdminSession,changePassword ,sendBroadcastNotification} = require("../controllers/adminController");
const { verifyAdminToken } = require("../middleware/authMiddleware");
const socket = require("../socket");
const router = express.Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/check-session", verifyAdminToken, checkAdminSession);
router.put(
  "/change-password",
  verifyAdminToken,
  changePassword
);

router.post(
    "/broadcast-notification",
    sendBroadcastNotification
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

router.post(
  "/open-notification",
  async (req, res) => {

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

    const [rows] = await db.query(`
      SELECT COUNT(*) AS count
      FROM admin_notifications
      WHERE is_open = 0
    `);

    res.json({
      success: true,
      count: rows[0].count
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server Error"
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

    const ioInstance = socket.getIO();

    if (ioInstance) {
      ioInstance.emit("admin_notification", {
        title,
        message,
        type,
        reference_id
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification sent successfully"
    });

  } catch (error) {

    console.error("Notification Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to send notification"
    });
  }
});
module.exports = router;
