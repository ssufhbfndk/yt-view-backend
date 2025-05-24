const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

dotenv.config();

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey";

// 🔹 Middleware to Protect Routes (with Refresh Logic)
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

    if (now - lastActivity > 24 * 60 * 60 * 1000) {
      return res.status(401).json({ success: false, message: "Session expired due to inactivity." });
    }

    const adminId = decoded.id;

    // 🔒 Single Device Check
    db.query("SELECT current_token FROM adminuser WHERE id = ?", [adminId], (dbErr, results) => {
      if (dbErr || results.length === 0) {
        return res.status(500).json({ success: false, message: "Database error or admin not found." });
      }

      const dbToken = results[0].current_token;
      if (dbToken !== token) {
        return res.status(401).json({ success: false, message: "Logged in on another device." });
      }

      // ✅ Refresh Token
      const newToken = jwt.sign(
        { id: decoded.id, username: decoded.username, lastActivity: now },
        SECRET_KEY,
        { expiresIn: "7d" }
      );

      // 🔄 Update DB and Cookie
      db.query("UPDATE adminuser SET current_token = ? WHERE id = ?", [newToken, adminId]);
      res.cookie("admin_token", newToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      req.admin = decoded;
      next();
    });
  });
};

// 🔹 Middleware: Verify token & enforce single device login
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
    return res.status(401).json({ success: false, message: "Unauthorized: No token provided" });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Unauthorized: Invalid token" });
    }

    // ✅ Check if this token matches the one stored in DB (single device enforcement)
    const checkTokenQuery = "SELECT jwt_token FROM user WHERE id = ?";
    db.query(checkTokenQuery, [decoded.id], (dbErr, results) => {
      if (dbErr || results.length === 0) {
        return res.status(403).json({ success: false, message: "Unauthorized: User not found" });
      }

      const storedToken = results[0].jwt_token;

      if (storedToken !== token) {
        return res.status(403).json({ success: false, message: "Logged in from another device" });
      }

      req.user = decoded;
      next();
    });
  });
};
