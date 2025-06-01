const db = require("../config/db");
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey";

// ✅ User Login (One Device Only)
exports.userClientLogin = (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required." });
  }

  const query = "SELECT * FROM user WHERE username = ?";
  db.query(query, [username], (err, results) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ success: false, message: "Database error." });
    }

    if (results.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid username" });
    }

    const user = results[0];
    const storedToken = user.jwt_token;

    // Check if token exists and still valid
    if (storedToken) {
      try {
        jwt.verify(storedToken, SECRET_KEY); // Valid token
        return res.status(403).json({
          success: false,
          message: "User already logged in on another device.",
        });
      } catch (err) {
        // Token expired — allow login
        console.log("Old token expired, logging in again.");
      }
    }

    // ✅ Generate new token
    const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, {
      expiresIn: "24h",
    });

    // ✅ Store token in DB
    const updateQuery = "UPDATE user SET jwt_token = ?, token_created_at = NOW() WHERE id = ?";
    db.query(updateQuery, [token, user.id], (err) => {
      if (err) {
        console.error("DB update error:", err);
        return res.status(500).json({ success: false, message: "Login failed." });
      }

      // ✅ Send HTTP-only cookie
      res.cookie("user_token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 24 * 60 * 60 * 1000,
      });

      return res.status(200).json({
        success: true,
        message: "User logged in successfully.",
        user: { id: user.id, username: user.username },
        token,
      });
    });
  });
};

// ✅ Logout clears token
exports.logout = (req, res) => {
  const token = req.cookies.user_token;

  if (!token) {
    return res.clearCookie("user_token").json({ success: true, message: "Already logged out" });
  }

  // Decode token to get user id
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err || !decoded?.id) {
      return res.clearCookie("user_token").json({ success: true, message: "Invalid session" });
    }

    const query = "UPDATE user SET jwt_token = NULL, token_created_at = NULL WHERE id = ?";
    db.query(query, [decoded.id], (err) => {
      if (err) {
        console.error("Logout DB error:", err);
        return res.status(500).json({ success: false, message: "Logout failed." });
      }

      res.clearCookie("user_token");
      res.json({ success: true, message: "User logged out successfully" });
    });
  });
};

// ✅ Session Check
eexports.checkUserSession = (req, res) => {
  if (!req.user) {
    // 200 status with success false
    return res.status(200).json({
      success: false,
      sessionExpired: true,
      message: "Session expired or not found."
    });
  }

  return res.status(200).json({
    success: true,
    sessionExpired: false,
    message: "Session is active.",
    user: req.user,
  });
};
