const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const db = require("../config/db"); // ✅ Ensure correct database import

const sessionStore = new MySQLStore(
  {
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 min
    expiration: 86400000, // 24 hours
  },
  db
);

const sessionMiddleware = session({
  key: "user_sid",
  secret: process.env.SESSION_SECRET || "supersecretkey",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS in production
    httpOnly: true,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000, // 1 day session
  },
});

module.exports = sessionMiddleware; // ✅ Ensure correct export
