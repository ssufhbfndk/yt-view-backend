const db = require("../config/db"); // ✅ Ensure correct database import

exports.userClientLogin = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "https://yt-view-front.vercel.app");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: "Username are required." });
  }

  const query = "SELECT * FROM user WHERE username = ?";

  db.queryAsync(query, [username], (err, results) => {

    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ success: false, message: "Database error." });
    }

    if (results.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid username" });
    }

    const clientUser = results[0];

    req.session.clientUser = { id: clientUser.id, username: clientUser.username };
    res.json({ success: true, message: "User logged in.", clientUser: req.session.clientUser });
  });
};

// 🔹 Logout User
exports.logout = (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: "User logged out" });
      });
};

// 🔹 Check Session
exports.checkUserSession = (req, res) => {
  
    if (req.session.clientUser) {
      
        res.json({ success: true, user: req.session.clientUser });
      } else {
        res.json({ success: false });
      }
};
