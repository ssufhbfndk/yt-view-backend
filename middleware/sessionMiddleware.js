const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const db = require("../config/db");

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
  saveUninitialized: true, // 🔹 Ensure session saves even if empty
  store: sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === "production" ? true : false, // 🔹 Secure only in production
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", // 🔹 Lax for local, None for prod
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  },
});

module.exports = sessionMiddleware;
