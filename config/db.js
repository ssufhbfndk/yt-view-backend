const mysql = require("mysql2");
const dotenv = require("dotenv");

dotenv.config();

// Create MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Enhanced database interface
const db = {
  // Callback-style query
  query: (sql, params, callback) => {
    pool.getConnection((err, connection) => {
      if (err) {
        console.error("❌ Database Connection Error:", err.message);
        return callback(err, null);
      }
      connection.query(sql, params, (queryErr, results) => {
        connection.release();
        callback(queryErr, results);
      });
    });
  },

  // Promise-style query
  queryAsync: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      pool.getConnection((err, connection) => {
        if (err) {
          console.error("❌ Database Connection Error:", err.message);
          return reject(err);
        }
        connection.query(sql, params, (queryErr, results) => {
          connection.release();
          if (queryErr) reject(queryErr);
          else resolve(results);
        });
      });
    });
  },

  // Get connection for manual transaction handling
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

  // New transaction method that matches your usage
  executeTransaction: async (transactionFn) => {
    const connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    try {
      await new Promise((resolve, reject) => {
        connection.beginTransaction(err => err ? reject(err) : resolve());
      });

      // Execute the transaction function with the connection
      const result = await transactionFn({
        query: (sql, params) => {
          return new Promise((resolve, reject) => {
            connection.query(sql, params, (err, results) => {
              if (err) reject(err);
              else resolve(results);
            });
          });
        }
      });

      await new Promise((resolve, reject) => {
        connection.commit(err => err ? reject(err) : resolve());
      });

      return result;
    } catch (error) {
      await new Promise(resolve => {
        connection.rollback(() => resolve());
      });
      throw error;
    } finally {
      connection.release();
    }
  }
};

module.exports = db;