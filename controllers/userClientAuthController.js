const db = require("../config/db");
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey"; // Secure Secret Key

// 🔹 User Login (JWT-Based)
exports.userClientLogin = (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required." });
  }

  const query = "SELECT * FROM user WHERE username = ?";

  db.query(query, [username], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ success: false, message: "Database error." });
    }

    if (results.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid username" });
    }

    const clientUser = results[0];

    // ✅ Generate JWT Token
    const token = jwt.sign({ id: clientUser.id, username: clientUser.username }, SECRET_KEY, {
      expiresIn: "24h",
    });

    // ✅ Send Token in HTTP-Only Cookie
    res.cookie("user_token", token, {
      httpOnly: true,
      secure: true, // Requires HTTPS
      sameSite: "None",
      maxAge: 24 * 60 * 60 * 1000, // 1 day expiration
    });

    res.json({ 
      success: true, 
      message: "User logged in.", 
      user: { id: clientUser.id, username: clientUser.username },
      token: token // 🔥 ADD THIS
    });
  });
};

// 🔹 User Logout (Clears JWT Cookie)
exports.logout = (req, res) => {
  res.clearCookie("user_token", { httpOnly: true, secure: true, sameSite: "None" });
  res.json({ success: true, message: "User logged out" });
};

// 🔹 Check User Token (Session Check)
exports.checkUserSession = (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized: No user info" });
  }

  res.json({
    success: true,
    message: "Session is active",
    user: req.user
  });
};
