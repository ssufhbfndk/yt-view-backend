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
  connectionLimit: 30, // ✅ Allows multiple connections
  connectTimeout: 10000,
  queueLimit: 0,
});

// ✅ Wrap pool in promise-based queries
const db = {
  query: (sql, params, callback) => {
    pool.getConnection((err, connection) => {
      if (err) {
        console.error("❌ Database Connection Error:", err.message);
        return callback(err, null);
      }
      connection.query(sql, params, (queryErr, results) => {
        connection.release(); // ✅ Release connection after query execution
        callback(queryErr, results);
      });
    });
  },

  queryAsync: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          console.error("❌ Database Connection Error:", err.message);
          return reject(err);
        }

        connection.query(sql, params, (queryErr, results) => {
          connection.release(); // ✅ Always release connection
          if (queryErr) reject(queryErr);
          else resolve(results);
        });
      });
    });
  },

  // ✅ Fix `.getConnection()` issue for transactions
  getConnection: () => {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          console.error("❌ Database Connection Error:", err.message);
          return reject(err);
        }
        resolve(connection);
      });
    });
  },
};

module.exports = db;
