const mysql = require("mysql2");
const dotenv = require("dotenv");

dotenv.config(); // Load environment variables

const pool = mysql.createPool({
  connectionLimit: 10, // Maximum parallel connections
  host: process.env.DB_HOST || "",
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "",
  waitForConnections: true,
  queueLimit: 0,
});

// Promisify for async/await support
const promisePool = pool.promise();

promisePool.getConnection()
  .then((connection) => {
    console.log("✅ MySQL Connected...");
    connection.release(); // Release connection after testing
  })
  .catch((err) => {
    console.error("❌ Database Connection Failed:", err.message);
    process.exit(1); // Exit process if DB connection fails
  });

// ✅ Use Promise-based queries
const queryAsync = async (sql, params) => {
  const connection = await promisePool.getConnection();
  try {
    const [results] = await connection.query(sql, params);
    return results;
  } catch (err) {
    throw err;
  } finally {
    connection.release(); // Ensure connection is released
  }
};

module.exports = { pool: promisePool, queryAsync };
