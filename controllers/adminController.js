const db = require("../config/db");
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey";

// 🔐 Token Generator
const generateToken = (admin) => {
  return jwt.sign(
    { id: admin.id, username: admin.username, lastActivity: Date.now() },
    SECRET_KEY,
    { expiresIn: "7d" }
  );
};

// 🔹 Admin Login (with Single-Device Logic)
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
    const token = generateToken(admin);

    // 🔄 Save token to DB (enforce single device session)
    const updateQuery = "UPDATE adminuser SET current_token = ? WHERE id = ?";
    db.query(updateQuery, [token, admin.id], (updateErr) => {
      if (updateErr) {
        console.error("Token update failed:", updateErr);
        return res.status(500).json({ success: false, message: "Login failed." });
      }

      res.cookie("admin_token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({ success: true, message: "Admin logged in.", admin: { id: admin.id, username: admin.username } });
    });
  });
};

// 🔹 Admin Logout (Clears Cookie and Token from DB)
exports.logout = (req, res) => {
  const token = req.cookies.admin_token;
  if (token) {
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
      if (!err && decoded && decoded.id) {
        const clearQuery = "UPDATE adminuser SET current_token = NULL WHERE id = ?";
        db.query(clearQuery, [decoded.id]);
      }
    });
  }

  res.clearCookie("admin_token", { httpOnly: true, secure: true, sameSite: "None" });
  res.json({ success: true, message: "Logged out successfully" });
};

// 🔹 Check Admin Session (JWT + Single Device Logic)
exports.checkAdminSession = (req, res) => {
  const token = req.cookies.admin_token;
  console.log(token);
  if (!token) {
    return res.status(401).json({ success: false, message: "No active session." });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
     console.log(decoded);
    if (err) {
      return res.status(403).json({ success: false, message: "Invalid or expired session." });
    }

    const now = Date.now();
    const lastActivity = decoded.lastActivity;

    if (now - lastActivity > 24 * 60 * 60 * 1000) {
      return res.status(401).json({ success: false, message: "Session expired due to inactivity." });
    }

    const adminId = decoded.id;

    const query = "SELECT current_token FROM adminuser WHERE id = ?";
    db.query(query, [adminId], (dbErr, results) => {
      if (dbErr || results.length === 0) {
        return res.status(500).json({ success: false, message: "Database error or admin not found." });
      }

      const dbToken = results[0].current_token;
      if (dbToken !== token) {
        return res.status(401).json({ success: false, message: "Logged in on another device. Session invalidated." });
      }

      // Optional: Refresh session token (rolling session)
      const refreshedToken = jwt.sign(
        {
          id: decoded.id,
          username: decoded.username,
          lastActivity: now,
        },
        SECRET_KEY,
        { expiresIn: "7d" }
      );

      // Update DB and Cookie
      db.query("UPDATE adminuser SET current_token = ? WHERE id = ?", [refreshedToken, adminId]);
      res.cookie("admin_token", refreshedToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({
        success: true,
        admin: { id: decoded.id, username: decoded.username },
      });
    });
  });
};

