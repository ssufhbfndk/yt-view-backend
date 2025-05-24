const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

dotenv.config();

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey";

// 🔹 Middleware to Verify Admin Token
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

    // 🔹 If inactive for more than 24 hours, force logout
    if (now - lastActivity > 24 * 60 * 60 * 1000) {
      return res.status(401).json({ success: false, message: "Session expired due to inactivity." });
    }

    // 🔹 If active, generate a new token with updated lastActivity
    const newToken = jwt.sign(
      { id: decoded.id, username: decoded.username, lastActivity: now },
      SECRET_KEY,
      { expiresIn: "7d" } // Keep token valid for 7 days
    );

    // 🔹 Update cookie with refreshed token
    res.cookie("admin_token", newToken, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    req.admin = decoded;
    next();
  });
};

// 🔹 Middleware to Verify user Token

// Middleware: Verify JWT token from header or cookie
exports.verifyUserToken = (req, res, next) => {
  // 1. Try to get token from Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  // 2. Or from cookies (assuming cookie-parser middleware is used)
  const cookieToken = req.cookies?.user_token;

  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];  // Extract token after "Bearer "
  } else if (cookieToken) {
    token = cookieToken;
  }

  // 3. If no token found, respond with 401 Unauthorized
  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: No token provided",
    });
  }

  // 4. Verify the token validity
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      // Token invalid or expired
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Invalid token",
      });
    }

    // 5. Store decoded token data in request for next middlewares/routes
    req.user = decoded;
    next();
  });
};
