const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const db = require("../config/db");

dotenv.config();

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey";

// ================================
// 🔹 VERIFY ADMIN TOKEN
// ================================
exports.verifyAdminToken = async (req, res, next) => {
  try {
    const token = req.cookies.admin_token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided"
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET_KEY);
    } catch (err) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Invalid token"
      });
    }

    const now = Date.now();
    const lastActivity = decoded.lastActivity;

    // 🔹 inactivity check (same logic)
    if (now - lastActivity > 24 * 60 * 60 * 1000) {
      return res.status(401).json({
        success: false,
        message: "Session expired due to inactivity."
      });
    }

    // 🔹 refresh token
    const newToken = jwt.sign(
      { id: decoded.id,  name: decoded.name,  username: decoded.username, lastActivity: now },
      SECRET_KEY,
      { expiresIn: "7d" }
    );

    res.cookie("admin_token", newToken, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    req.admin = decoded;
    next();

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};


// ================================
// 🔹 VERIFY USER TOKEN
// ================================
exports.verifyUserToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.user_token;

    let token = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (cookieToken) {
      token = cookieToken;
    }

    if (!token) {
      return res.status(200).json({
        success: false,
        sessionExpired: true,
        message: "No token provided"
      });
    }

    // =========================
    // 🔥 VERIFY TOKEN
    // =========================
    let decoded;
    try {
      decoded = jwt.verify(token, SECRET_KEY);
    } catch (err) {
      return res.status(200).json({
        success: false,
        sessionExpired: true,
        message: "Invalid or expired token"
      });
    }

    // =========================
    // 🔥 GET USER (SAFE)
    // =========================
    const results = await db.queryAsync(
      "SELECT id, username, status, jwt_token FROM user WHERE id = ?",
      [decoded.id]
    );

    if (!results) {
      return res.status(500).json({
        success: false,
        message: "Session check failed."
      });
    }

    if (results.length === 0) {
      return res.status(200).json({
        success: false,
        sessionExpired: true,
        message: "User not found"
      });
    }

    const user = results[0];

    // =========================
    // 🔥 BLOCKED USER
    // =========================
    if (user.status === 0 || user.status === false) {

      // clear token (safe, non-blocking)
      await db.queryAsync(
        "UPDATE user SET jwt_token = NULL WHERE id = ?",
        [user.id]
      );

      return res.status(200).json({
        success: false,
        blocked: true,
        sessionExpired: true,
        message: "User is blocked by admin"
      });
    }

    // =========================
    // 🔥 TOKEN MISMATCH
    // =========================
    if (user.jwt_token !== token) {
      return res.status(200).json({
        success: false,
        sessionExpired: true,
        message: "User logged in from another device"
      });
    }

    // =========================
    // 🔥 UPDATE ACTIVITY (SAFE)
    // =========================
    await db.queryAsync(
      "UPDATE user SET token_created_at = NOW() WHERE id = ?",
      [user.id]
    );

    // =========================
    // ✅ ATTACH USER
    // =========================
    req.user = {
      id: user.id,
      username: user.username,
      status: user.status,
    };

    next();

  } catch (err) {
    console.error("Middleware error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};