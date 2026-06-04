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
module.exports = router;
