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

    // ✅ Store session data
    req.session.admin = { id: admin.id, username: admin.username };

    // ✅ Manually set session cookie
    res.cookie("user_sid", req.sessionID, {
      httpOnly: true,
      secure: true, // HTTPS required
      sameSite: "None",
    });

    console.log("Session ID after login:", req.sessionID);
    console.log("Session data:", req.session);

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
    console.log("Incoming Session ID:", req.sessionID);
  console.log("Cookies Received:", req.headers.cookie);
  console.log("Session Data:", req.session);
  console.log("Admin Data:", req.session.admin);
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
  
