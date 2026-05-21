const mysql = require("mysql2/promise");
require("dotenv").config();

// ================================
// 🔥 POOL (OPTIMIZED FOR HIGH LOAD)
// ================================
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,

  connectionLimit: 20,   // 🔥 slightly higher but stable
  queueLimit: 200,       // 🔥 prevent overload crash

  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 8000
});

// ================================
// 🔥 LOAD CONTROL (IMPROVED)
// ================================
let activeRequests = 0;
const MAX_ACTIVE = 300; // 🔥 increased safe threshold

// ================================
// 🔥 CIRCUIT BREAKER (SMART)
// ================================
let dbDown = false;
let failCount = 0;

// ================================
// ✅ SAFE QUERY (FAST + STABLE)
// ================================
const queryAsync = async (sql, params = []) => {

  // 🔥 overload protection
  if (activeRequests >= MAX_ACTIVE) {
    return null; // fail fast (important for 1k+ req/sec)
  }

  if (dbDown) {
    return null;
  }

  activeRequests++;

  try {
    const [rows] = await pool.query({
      sql,
      timeout: 6000 // 🔥 reduced for fast fail
    }, params);

    // reset fail count on success
    failCount = 0;

    return rows;

  } catch (err) {

    console.error("❌ DB ERROR:", err.message);

    failCount++;

    // 🔥 smarter circuit breaker
    if (failCount >= 5) {
      dbDown = true;

      setTimeout(() => {
        dbDown = false;
        failCount = 0;
        console.log("✅ DB RECOVERED");
      }, 5000);
    }

    return null;

  } finally {
    activeRequests--;
  }
};

// ================================
// 🔥 TRANSACTION WRAPPER (SAFE)
// ================================
const withTransaction = async (callback) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const result = await callback(conn);

    await conn.commit();
    return result;

  } catch (err) {
    try {
      await conn.rollback();
    } catch (e) {}

    console.error("❌ TX ERROR:", err.message);
    return null;

  } finally {
    conn.release();
  }
};

// ================================
// 🔥 FAST ORDER PICK (OPTIMIZED)
// ================================
const pickOrder = async (userId) => {
  return await withTransaction(async (conn) => {

    // 🔥 OPTIMIZED QUERY (index-friendly)
    const [rows] = await conn.query(`
      SELECT id
      FROM orders
      WHERE status='available'
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE
    `);

    if (!rows.length) return null;

    const orderId = rows[0].id;

    await conn.query(`
      UPDATE orders
      SET status='assigned', user_id=?
      WHERE id=? AND status='available'
    `, [userId, orderId]);

    return orderId;
  });
};

// ================================
// EXPORT
// ================================
module.exports = {
  queryAsync,
  withTransaction,
  pickOrder
};