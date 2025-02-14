const mysql = require("mysql2");
const dotenv = require("dotenv");

dotenv.config(); // Load environment variables

const db = mysql.createConnection({
  host: process.env.DB_HOST || "sql12.freesqldatabase.com",
  user: process.env.DB_USER || "sql12762426",
  password: process.env.DB_PASS || "x9hq1SYLx3",
  database: process.env.DB_NAME || "sql12762426",
});

db.connect((err) => {
  if (err) {
    console.error("❌ Database Connection Failed:", err.message);
    process.exit(1); // Exit process if DB connection fails
  } else {
    console.log("✅ MySQL Connected...");
  }
});

// ✅ Use Promise-based queries
db.queryAsync = (sql, params) => {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

module.exports = db;
