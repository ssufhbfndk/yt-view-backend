const db = require("../config/db");
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey"; // Secure Secret Key

// 🔹 User Login (JWT-Based)
// 🔹 User Login (Single-Device JWT-Based)
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

    // ✅ Update token in DB to enforce single device login
    const updateTokenQuery = "UPDATE user SET jwt_token = ? WHERE id = ?";
    db.query(updateTokenQuery, [token, clientUser.id], (updateErr) => {
      if (updateErr) {
        console.error("Token update error:", updateErr);
        return res.status(500).json({ success: false, message: "Token update failed." });
      }

      // ✅ Set cookie
      res.cookie("user_token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 24 * 60 * 60 * 1000,
      });

      res.json({
        success: true,
        message: "User logged in.",
        user: { id: clientUser.id, username: clientUser.username },
        token: token,
      });
    });
  });
};

// 🔹 User Logout (Clears JWT Cookie)
// 🔹 User Logout
exports.logout = (req, res) => {
  const token = req.cookies.user_token;

  if (token) {
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      const updateQuery = "UPDATE user SET jwt_token = NULL WHERE id = ?";
      db.query(updateQuery, [decoded.id], () => {
        res.clearCookie("user_token", { httpOnly: true, secure: true, sameSite: "None" });
        res.json({ success: true, message: "User logged out." });
      });
    } catch (err) {
      res.clearCookie("user_token", { httpOnly: true, secure: true, sameSite: "None" });
      res.json({ success: true, message: "Invalid token. Logged out anyway." });
    }
  } else {
    res.json({ success: true, message: "No token found." });
  }
};


// 🔹 Check User Token (Session Check)
exports.checkUserSession = (req, res) => {
  const token = req.cookies.user_token;

  if (!token) {
    return res.status(401).json({ success: false, message: "No active session." });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Invalid session." });
    }

    res.json({ success: true, user: decoded });
  });
};
