const db = require("../config/db"); // ✅ Ensure correct database import
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000, // 15 min
  expiration: 86400000, // 24 hours
  createDatabaseTable: true
}, db); // Ensure `db` is the active MySQL connection


 const sessionMiddleware = session({
    key: "user_sid",
    secret: process.env.SESSION_SECRET || "supersecretkey",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true, // Ensure HTTPS is being used
      httpOnly: true,
      sameSite: "None",
      maxAge: 86400000, // 24 hours
    },
  })



module.exports = sessionMiddleware; // ✅ Ensure correct export
