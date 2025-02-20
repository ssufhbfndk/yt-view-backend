const express = require("express");
const { login, logout, checkAdminSession } = require("../controllers/adminController");
const { verifyAdminToken } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/check-session", verifyAdminToken, checkAdminSession);

module.exports = router;
