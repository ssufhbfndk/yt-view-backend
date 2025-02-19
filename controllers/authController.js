const db = require("../config/db"); // ✅ Ensure correct database import

exports.login = (req, res) => {
  const { username, password } = req.body;
console.log(req.body);
  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required." });
  }

  const query = "SELECT * FROM adminuser WHERE username = ?";

  db.query(query, [username], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ success: false, message: "Database error." });
    }

    if (results.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    const admin = results[0];

    if (admin.password !== password) {
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    // Log the session ID when the session is created
  console.log("Session ID after login:", req.sessionID);
  console.log("Session data:", req.session);

    req.session.admin = { id: admin.id, username: admin.username };
    res.json({ success: true, message: "Admin logged in.", admin: req.session.admin });
  });
};

// 🔹 Logout User
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("❌ Logout Error:", err.message);
      return res.status(500).json({ success: false, message: "Logout failed" });
    }
    res.json({ success: true, message: "Logged out successfully" });
  });
};

// 🔹 Check Session

  exports.checkAdminSession = (req, res) => {
    // Log the entire session data for debugging purposes
    console.log("Session Data:", req.session);  // Log the whole session
    console.log("Admin Data:", req.session.admin);  // Log the admin-specific session data
    console.log("Session ID:", req.sessionID);  // Log the session ID
    if (req.session && req.session.admin) {
      // If session exists and admin data is available, return success response
      console.log("Active session found:", req.session.admin);
      return res.json({ success: true, admin: req.session.admin });
    } else {
      // If no session is found, return error message
      console.log("No active session found.");
      return res.json({ success: false, message: "No active session." });
    }
  };
  
