const db = require("../config/db"); // ✅ Ensure correct database import

// 🔹 Admin Login
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required." });
    }

    const query = "SELECT * FROM adminuser WHERE username = ?";
    const results = await db.queryAsync(query, [username]);

    // ✅ Fix: Check if `results` exists and has data
    if (!results || results.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    const admin = results[0]; // ✅ Now this is safe

    if (admin.password !== password) {
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    req.session.admin = { id: admin.id, username: admin.username };
    res.json({ success: true, message: "Admin logged in.", admin: req.session.admin });

  } catch (err) {
    console.error("❌ Login Error:", err.message);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
};


// 🔹 Logout Admin
exports.logout = async (req, res) => {
  try {
    req.session.destroy((err) => {
      if (err) {
        console.error("❌ Logout Error:", err.message);
        return res.status(500).json({ success: false, message: "Logout failed" });
      }
      res.json({ success: true, message: "Logged out successfully" });
    });
  } catch (err) {
    console.error("❌ Logout Error:", err);
    res.status(500).json({ success: false, message: "Logout failed" });
  }
};

// 🔹 Check Admin Session
exports.checkAdminSession = (req, res) => {
  try {
    if (req.session && req.session.admin) {
      return res.json({ success: true, admin: req.session.admin });
    } else {
      return res.json({ success: false, message: "No active session." });
    }
  } catch (error) {
    console.error("❌ Session Check Error:", error);
    return res.status(500).json({ success: false, message: "Server error while checking session." });
  }
};

