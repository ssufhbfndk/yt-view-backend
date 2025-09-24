const mysql = require("mysql2");
const dotenv = require("dotenv");

dotenv.config(); // Load environment variables

// ✅ Create a MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "",
  waitForConnections: true,
  connectionLimit: 100, // Allows multiple connections
  connectTimeout: 10000,
  queueLimit: 0,
});

// ✅ Wrap pool in promise-based queries
const db = {
  // Callback style (for existing APIs)
  query: (sql, params, callback) => {
    pool.query(sql, params, callback); // ✅ Direct pool query, no getConnection
  },

  // Promise style
  queryAsync: (sql, params = []) => {
    return pool.promise().query(sql, params).then(([results]) => results);
  },

  // Transactions / single connection usage
  getConnection: () => {
    return pool.promise().getConnection(); // ✅ returns promise-based connection
  },
};

module.exports = db;
