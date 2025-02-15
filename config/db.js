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
  connectionLimit: 10, // ✅ Allows multiple connections
  queueLimit: 0,
});

// ✅ Function for callback-based queries (same as before)
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

  // ✅ Function for promise-based queries (same as before)
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
};

module.exports = db;
