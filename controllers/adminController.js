const db = require("../config/db");
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey";

const generateToken = (admin) => {
  return jwt.sign(
    { id: admin.id, username: admin.username, lastActivity: Date.now() },
    SECRET_KEY,
    { expiresIn: "7d" } // Token valid for 7 days, but inactive users are logged out after 24 hours
  );
};


// 🔹 Admin Login (JWT Based)
exports.login = (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required." });
  }

  const query = "SELECT * FROM adminuser WHERE username = ?";

  db.query(query, [username], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ success: false, message: "Database error." });
    }

    if (results.length === 0 || results[0].password !== password) {
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    const admin = results[0];

    // ✅ Generate JWT Token
    const token = generateToken(admin);

    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 7 * 24 * 60 * 60 * 1000, // Cookie valid for 7 days
    });

    res.json({ success: true, message: "Admin logged in.", admin: { id: admin.id, username: admin.username } });
  });
};

// 🔹 Admin Logout (Clears Cookie)
exports.logout = (req, res) => {
  res.clearCookie("admin_token", { httpOnly: true, secure: true, sameSite: "None" });
  res.json({ success: true, message: "Logged out successfully" });
};

// 🔹 Check Admin Session (JWT Validation)
exports.checkAdminSession = (req, res) => {
  const token = req.cookies.admin_token;

  if (!token) {
    return res.status(401).json({ success: false, message: "No active session." });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Invalid session." });
    }

    res.json({ success: true, admin: decoded });
  });
};
