const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const db = require("./db");

const sessionStore = new MySQLStore(
  {
    expiration: 60 * 60 * 1000, // 1 hour
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 min
  },
  db
);

const adminSession = session({
  key: "admin_sid",
  secret: "admin_secret",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: false, // Change to `true` if using HTTPS
    httpOnly: true,
    maxAge: 60 * 60 * 1000, // 1 hour
  },
});

const userSession = session({
  key: "user_sid",
  secret: "user_secret",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 60 * 60 * 1000, // 1 hour
  },
});

module.exports = { adminSession, userSession };
