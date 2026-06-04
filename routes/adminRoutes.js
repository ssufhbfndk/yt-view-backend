const express = require("express");
const db = require("../config/db");
const { login, logout, checkAdminSession,changePassword ,sendBroadcastNotification} = require("../controllers/adminController");
const { verifyAdminToken } = require("../middleware/authMiddleware");

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
router.get(
  "/notifications",
  verifyAdminToken,
  async (req, res) => {
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
module.exports = router;
