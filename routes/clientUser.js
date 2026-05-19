const express = require("express");
const { userClientLogin, logout, checkUserSession } = require("../controllers/userClientAuthController");
const { verifyUserToken } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", userClientLogin); // ✅ User Login
router.post("/logout", logout); // ✅ User Logout
router.get("/check-session", verifyUserToken, checkUserSession); // ✅ Protected Session Check

module.exports = router;
