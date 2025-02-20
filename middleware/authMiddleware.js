const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

dotenv.config();

const SECRET_KEY = process.env.JWT_SECRET || "supersecretkey";

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

    req.admin = decoded; // Store admin data in request
    next();
  });
};


exports.protectUser = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "User Unauthorized" });
  }
  next();
};
