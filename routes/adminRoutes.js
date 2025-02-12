const express = require("express");
const { login, logout, checkAdminSession } = require("../controllers/authController");

const router = express.Router();

router.post("/login", login); // ✅ Correct path
router.post("/logout", logout);
router.get("/check-session", checkAdminSession);

module.exports = router;