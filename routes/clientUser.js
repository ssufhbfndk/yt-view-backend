const express = require("express");
const { userClientLogin,logout, checkUserSession } = require("../controllers/userClientAuthController");

const router = express.Router();

router.post("/login", userClientLogin); // ✅ Correct path
router.post("/logout", logout);
router.get("/check-session", checkUserSession);

module.exports = router;
