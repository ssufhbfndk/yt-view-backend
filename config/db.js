const mysql = require("mysql2/promise");
require("dotenv").config(); // Load environment variables

// ✅ Create MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "",
  waitForConnections: true,
  connectionLimit: 10, // Adjust as needed
  queueLimit: 0,
});

// ✅ Test Database Connection
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log("✅ MySQL Connected...");
    connection.release(); // Release connection
  } catch (err) {
    console.error("❌ Database Connection Failed:", err.message);
    process.exit(1); // Exit process if DB connection fails
  }
})();

// ✅ Function for Async Queries
const queryAsync = async (sql, params) => {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    console.error("❌ Database Query Error:", err.message);
    throw err;
  }
};

module.exports = { pool, queryAsync };
