const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const db = require("../config/db");

const sessionStore = new MySQLStore(
  {
    clearExpired: true,
    checkExpirationInterval: 600000, // 10 min
    expiration: 86400000, // 24 hours
  },
  db
);

const sessionMiddleware = session({
  key: "user_sid",
  secret: process.env.SESSION_SECRET || "supersecretkey",
  resave: false,
  saveUninitialized: false, // ✅ Only save session after login
  store: sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === "production", // ✅ Only secure in production
    httpOnly: true,
    sameSite: "None", // ✅ Fix cross-origin issues
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  },
});

module.exports = sessionMiddleware;
