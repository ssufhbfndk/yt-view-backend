const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const db = require("../config/db");

dotenv.config();

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey";

// 🔹 Middleware to Verify Admin Token
exports.verifyAdminToken = (req, res, next) => {
  const token = req.cookies.admin_token;

  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized: No token provided" });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Unauthorized: Invalid token" });
    }

    const now = Date.now();
    const lastActivity = decoded.lastActivity;

    // 🔹 If inactive for more than 24 hours, force logout
    if (now - lastActivity > 24 * 60 * 60 * 1000) {
      return res.status(401).json({ success: false, message: "Session expired due to inactivity." });
    }

    // 🔹 If active, generate a new token with updated lastActivity
    const newToken = jwt.sign(
      { id: decoded.id, username: decoded.username, lastActivity: now },
      SECRET_KEY,
      { expiresIn: "7d" } // Keep token valid for 7 days
    );

    // 🔹 Update cookie with refreshed token
    res.cookie("admin_token", newToken, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    req.admin = decoded;
    next();
  });
};

// 🔹 Middleware to Verify user Token

exports.verifyUserToken = (req, res, next) => {
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

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(200).json({
        success: false,
        sessionExpired: true,
        message: "Invalid or expired token"
      });
    }

    const query = "SELECT id, username, status, jwt_token FROM user WHERE id = ?";
    db.query(query, [decoded.id], (err, results) => {
      if (err) {
        console.error("DB error:", err);
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

      if (user.status === 0 || user.status === false) {
  // Clear token in DB
  const clearTokenQuery = "UPDATE user SET jwt_token = NULL WHERE id = ?";
  db.query(clearTokenQuery, [user.id], (err) => {
    if (err) {
      console.error("Failed to clear token:", err);
    }
  });

  return res.status(200).json({
    success: false,
    blocked: true,
    sessionExpired: true,
    message: "User is blocked by admin"
  });
}


      if (user.jwt_token !== token) {
        return res.status(200).json({
          success: false,
          sessionExpired: true,
          message: "User logged in from another device"
        });
      }

      // ✅ Update token_created_at to mark user as active now
      const updateQuery = "UPDATE user SET token_created_at = NOW() WHERE id = ?";
      db.query(updateQuery, [user.id], (err) => {
        if (err) {
          console.warn("Warning: Couldn't update token_created_at:", err);
        }
        // Continue anyway
        req.user = {
          id: user.id,
          username: user.username,
          status: user.status,
        };
        next();
      });
    });
  });
};
