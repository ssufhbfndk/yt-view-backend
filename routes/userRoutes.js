const express = require("express");

const router = express.Router();
const db = require("../config/db"); // MySQL Connection
const bcrypt = require("bcrypt");
const { queryAsync,  } = require("../config/db");
const socket = require("../socket");
const admin = require("../firebaseAdmin");


// 🛠 Check if user exists
// 🛠 Check if user exists
router.post("/check-username", async (req, res) => {
  const { username } = req.body;

  

  // 🔥 validation
  if (!username || typeof username !== "string" || username.trim() === "") {
    console.log("❌ Invalid username input");

    return res.status(400).json({
      success: false,
      message: "Username is required and must be a string.",
    });
  }

  try {
    console.log("🔹 Running DB query for username:", username);

    // =========================
    // 🔥 SAFE QUERY
    // =========================
    const results = await db.queryAsync(
      "SELECT 1 FROM user WHERE username = ? LIMIT 1",
      [username]
    );

    console.log("🔹 Query result:", results);

    // DB overload / down case
    if (!results) {
      return res.status(500).json({
        success: false,
        error: "Database busy or down.",
      });
    }

    return res.json({
      exists: results.length > 0,
    });

  } catch (err) {
    console.error("❌ Database Error in /check-username:", err.message);

    return res.status(500).json({
      success: false,
      error: "Internal server error.",
    });
  }
});

// 🛠 Get all users
router.get("/get-users", async (req, res) => {
  try {
    let { page, limit, status } = req.query;

    // ================================
    // REQUIRED
    // ================================
    if (!page || !limit) {
      return res.status(400).json({
        success: false,
        message: "page and limit required",
      });
    }

    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    // ================================
    // STATUS FILTER
    // ================================
    if (
      status !== undefined &&
      status !== "all" &&
      status !== "lastactive"
    ) {
      const statusMap = {
        active: 1,
        blocked: 0,
        1: 1,
        0: 0,
      };

      const statusValue = statusMap[status];

      if (statusValue !== undefined) {
        where.push("status = ?");
        params.push(statusValue);
      }
    }

    const whereSQL = where.length
      ? "WHERE " + where.join(" AND ")
      : "";

    // ================================
    // ORDER BY
    // ================================
    let orderBy = "ORDER BY id DESC";

    if (status === "lastactive") {
      orderBy = "ORDER BY token_created_at DESC";
    }

    // ================================
    // MAIN QUERY
    // ================================
    const sql = `
      SELECT
        id,
        name,
        username,
        email,
        number,
        status,
        num_views,
        token_created_at
      FROM user
      ${whereSQL}
      ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const users = await queryAsync(sql, [
      ...params,
      limit,
      offset,
    ]);

    // ================================
    // TOTAL COUNT
    // ================================
    const countSQL = `
      SELECT COUNT(*) as total
      FROM user
      ${whereSQL}
    `;

    const countResult = await queryAsync(
      countSQL,
      params
    );

    return res.json({
      success: true,
      users,
      total: countResult?.[0]?.total || 0,
      totalPages: Math.ceil(
        (countResult?.[0]?.total || 0) / limit
      ),
      page,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


// 🔍 Search users
router.get("/search-users", async (req, res) => {
  try {
    let { page, limit, status, search } = req.query;

    // ================================
    // REQUIRED
    // ================================
    if (!page || !limit) {
      return res.status(400).json({
        success: false,
        message: "page and limit required",
      });
    }

    if (!search || search.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "search required",
      });
    }

    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    // ================================
    // SEARCH
    // ================================
    where.push(`
      (
        username LIKE ?
        OR number LIKE ?
        OR name LIKE ?
      )
    `);

    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);

    // ================================
    // STATUS FILTER
    // ================================
    if (
      status !== undefined &&
      status !== "all" &&
      status !== "lastactive"
    ) {
      const statusMap = {
        active: 1,
        blocked: 0,
        1: 1,
        0: 0,
      };

      const statusValue = statusMap[status];

      if (statusValue !== undefined) {
        where.push("status = ?");
        params.push(statusValue);
      }
    }

    const whereSQL = where.length
      ? "WHERE " + where.join(" AND ")
      : "";

    // ================================
    // ORDER BY
    // ================================
    let orderBy = "ORDER BY id DESC";

    if (status === "lastactive") {
      orderBy = "ORDER BY token_created_at DESC";
    }

    // ================================
    // MAIN QUERY
    // ================================
    const sql = `
      SELECT
        id,
        name,
        username,
        email,
        number,
        status,
        num_views,
        token_created_at
      FROM user
      ${whereSQL}
      ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const users = await queryAsync([
      sql,
      [...params, limit, offset]
    ][0], [...params, limit, offset]);

    // ================================
    // TOTAL COUNT
    // ================================
    const countSQL = `
      SELECT COUNT(*) as total
      FROM user
      ${whereSQL}
    `;

    const countResult = await queryAsync(
      countSQL,
      params
    );

    return res.json({
      success: true,
      users,
      total: countResult?.[0]?.total || 0,
      totalPages: Math.ceil(
        (countResult?.[0]?.total || 0) / limit
      ),
      page,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ===============================
// UPDATE USER API
// ===============================

router.put("/update-user", async (req, res) => {

  try {

    const {
      user_id,
      number,
      status
    } = req.body;

    // =========================
    // VALIDATION
    // =========================

    if (!user_id) {

      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });

    }

    if (!number || number.trim() === "") {

      return res.status(400).json({
        success: false,
        message: "Mobile number is required",
      });

    }

    // ✅ STATUS ONLY 0 / 1
    if (
      status != 0 &&
      status != 1
    ) {

      return res.status(400).json({
        success: false,
        message: "Status must be 0 or 1",
      });

    }

    // =========================
    // CHECK USER
    // =========================

    const checkUser = await queryAsync(
      `
      SELECT id
      FROM user
      WHERE id = ?
      LIMIT 1
      `,
      [user_id]
    );

    if (!checkUser || checkUser.length === 0) {

      return res.status(404).json({
        success: false,
        message: "User not found",
      });

    }

    // =========================
    // UPDATE USER
    // =========================

    const updateUser = await queryAsync(
      `
      UPDATE user
      SET
        number = ?,
        status = ?
      WHERE id = ?
      `,
      [
        number.trim(),
        status, // ✅ 0 / 1 direct save
        user_id
      ]
    );

    if (updateUser === null) {

      return res.status(500).json({
        success: false,
        message: "Database error",
      });

    }

    // =========================
    // SUCCESS
    // =========================

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      updated_user: {
        id: user_id,
        number,
        status,
      }
    });

  } catch (error) {

    console.log(
      "UPDATE USER ERROR:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Server error",
    });

  }

});

// get num of watch video
router.get("/num-views/:username", async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Username is required"
    });
  }

  try {

    // =========================
    // 🔥 FAST QUERY (SAFE)
    // =========================
    const rows = await db.queryAsync(
      "SELECT num_views FROM user WHERE username = ? LIMIT 1",
      [username]
    );

    // DB overload / down case
    if (!rows) {
      return res.status(500).json({
        success: false,
        message: "Database busy or down"
      });
    }

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    return res.json({
      success: true,
      num_views: rows[0].num_views
    });

  } catch (err) {
    console.error("❌ Error fetching num_views:", err.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});
// when video watch one add

router.post("/increment-views", async (req, res) => {

  const {
    username,
    points,
    order_id
  } = req.body;

  // =====================================
  // VALIDATION
  // =====================================
  if (!username || points === undefined || !order_id) {
    return res.status(400).json({
      success: false,
      message: "username, points, order_id required"
    });
  }

  if (isNaN(points) || Number(points) <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid points"
    });
  }

  try {

    const result = await db.withTransaction(async (conn) => {

      // =====================================
      // 1. CHECK SKIP POINT
      // =====================================
      const [skipRows] = await conn.query(
        `
        SELECT id
        FROM skip_point
        WHERE order_id = ?
        LIMIT 1
        `,
        [order_id]
      );

      // =====================================
      // 2. ALWAYS DECREASE REMAINING
      // =====================================
      let orderUpdated = false;

      // MAIN ORDERS
      const [mainUpdate] = await conn.query(
        `
        UPDATE orders
        SET remaining = GREATEST(remaining - 1, 0)
        WHERE order_id = ?
        AND remaining > 0
        `,
        [order_id]
      );

      if (mainUpdate.affectedRows > 0) {
        orderUpdated = true;
      }

      // TEMP ORDERS
      if (!orderUpdated) {

        const [tempUpdate] = await conn.query(
          `
          UPDATE temp_orders
          SET remaining = GREATEST(remaining - 1, 0)
          WHERE order_id = ?
          AND remaining > 0
          `,
          [order_id]
        );

        if (tempUpdate.affectedRows > 0) {
          orderUpdated = true;
        }
      }

      // =====================================
      // ORDER NOT FOUND
      // =====================================
      if (!orderUpdated) {

        return {
          error: "ORDER_NOT_FOUND"
        };
      }

      // =====================================
      // 3. IF ORDER EXISTS IN SKIP POINT
      // → NO COIN UPDATE
      // =====================================
      if (skipRows.length > 0) {

        return {
          success: true,
          skip: true,
          message: "Remaining decreased only"
        };
      }

      // =====================================
      // 4. UPDATE USER COINS
      // =====================================
      const [updateUser] = await conn.query(
        `
        UPDATE user
        SET num_views = num_views + ?
        WHERE username = ?
        `,
        [
          points,
          username
        ]
      );

      // USER NOT FOUND
      if (updateUser.affectedRows === 0) {

        return {
          error: "USER_NOT_FOUND"
        };
      }

      // =====================================
      // 5. GET UPDATED COINS
      // =====================================
      const [userRows] = await conn.query(
        `
        SELECT num_views
        FROM user
        WHERE username = ?
        LIMIT 1
        `,
        [username]
      );

      // =====================================
      // SUCCESS
      // =====================================
      return {
        success: true,
        num_views: userRows[0]?.num_views || 0
      };

    });

    // =====================================
    // DB ERROR
    // =====================================
    if (!result) {
      return res.status(500).json({
        success: false,
        message: "Database error"
      });
    }

    // =====================================
    // USER NOT FOUND
    // =====================================
    if (result.error === "USER_NOT_FOUND") {

      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // =====================================
    // ORDER NOT FOUND
    // =====================================
    if (result.error === "ORDER_NOT_FOUND") {

      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    // =====================================
    // SKIP RESPONSE
    // =====================================
    if (result.skip) {

      return res.json({
        success: true,
        skip: true,
        message: "Coins updated successfully"
      });
    }

    // =====================================
    // SUCCESS RESPONSE
    // =====================================
    return res.json({
      success: true,
      num_views: result.num_views,
      message: "Coins updated successfully"
    });

  } catch (error) {

    console.error(
      "❌ increment-views error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});
// POST /signup

router.post("/signup", async (req, res) => {

  const {
    name,
    username,
    email,
    password,
    number
  } = req.body;

  // ================================
  // ✅ VALIDATION
  // ================================
  if (!name || !username || !password || !number) {
    return res.status(400).json({
      success: false,
      message: "All fields are required."
    });
  }

  // ================================
  // ✅ USERNAME FORMAT VALIDATION
  // ================================
  if (!username.match(/^[a-zA-Z0-9_]+$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid username"
    });
  }

  // ================================
  // ✅ EMAIL FORMAT VALIDATION (OPTIONAL)
  // ================================
  if (email && !email.match(/^[A-Za-z0-9._%+-]+@gmail\.com$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Gmail address"
    });
  }

  try {

    const result = await db.withTransaction(async (conn) => {



      // ================================
      // 1️⃣ CHECK USERNAME EXISTS
      // ================================
      const [existingUser] = await conn.query(
        "SELECT username FROM user WHERE username = ? LIMIT 1",
        [username]
      );

      if (existingUser.length > 0) {
        return { error: "USER_EXISTS" };
      }

      // ================================
      // 2️⃣ CHECK EMAIL EXISTS (IMPORTANT FIX)
      // ================================
      if (email) {

        const [existingEmail] = await conn.query(
          "SELECT username FROM user WHERE email = ? LIMIT 1",
          [email]
        );

        if (existingEmail.length > 0) {
          return { error: "EMAIL_EXISTS" };
        }
      }


      // ================================
      // 3️⃣ HASH PASSWORD
      // ================================
      const hashedPassword = await bcrypt.hash(password, 10);

      // ================================
      // 4️⃣ INSERT USER
      // ================================
      await conn.query(
        `INSERT INTO user 
        (name, username, email, password, number, num_views)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
          name,
          username,
          email || null,
          hashedPassword,
          number,
          0
        ]
      );

      // ================================
      // 5️⃣ CREATE PROFILE TABLE
      // ================================
      const safeUsername = username.replace(/[^a-zA-Z0-9_]/g, "");
      const profileTable = `profile_${safeUsername}`;

      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`${profileTable}\` (
          order_id VARCHAR(50) PRIMARY KEY,
          channel_name VARCHAR(255) NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_channel (channel_name),
          INDEX idx_timestamp (timestamp)
        ) ENGINE=InnoDB
      `);

      console.log("✅ User created");

      return { success: true };
    });

    // ================================
    // RESPONSE HANDLING
    // ================================
    if (!result) {
      return res.status(500).json({
        success: false,
        message: "Database busy or error."
      });
    }

    if (result.error === "USER_EXISTS") {
      return res.status(400).json({
        success: false,
        message: "Username already exists."
      });
    }

    if (result.error === "EMAIL_EXISTS") {
      return res.status(400).json({
        success: false,
        message: "Email already exists."
      });
    }

    return res.json({
      success: true,
      message: "User registered successfully."
    });

  } catch (err) {
    console.error("❌ SIGNUP ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: err.message
    });
  }
});
//user name update

router.post("/update-name", async (req, res) => {

  const { username, name } = req.body;

  if (!username || !name) {
    return res.status(400).json({
      success: false,
      message: "Username and name required"
    });
  }

  try {

    const result = await db.queryAsync(
      "UPDATE user SET name = ? WHERE username = ?",
      [name, username]
    );

    if (!result) {
      return res.status(500).json({
        success: false,
        message: "Database error"
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    return res.json({
      success: true,
      message: "Name updated successfully"
    });

  } catch (err) {
    console.error("UPDATE NAME ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// user gmail update

router.post("/update-email", async (req, res) => {

  const { username, email } = req.body;

  if (!username || !email) {
    return res.status(400).json({
      success: false,
      message: "Username and email required"
    });
  }

  if (!email.match(/^[A-Za-z0-9._%+-]+@gmail\.com$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Gmail address"
    });
  }

  try {

    const existing = await db.queryAsync(
      "SELECT username FROM user WHERE email = ? LIMIT 1",
      [email]
    );

    if (existing && existing.length > 0 && existing[0].username !== username) {
      return res.status(400).json({
        success: false,
        message: "Email already in use"
      });
    }

    const result = await db.queryAsync(
      "UPDATE user SET email = ? WHERE username = ?",
      [email, username]
    );

    if (!result) {
      return res.status(500).json({
        success: false,
        message: "Database error"
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    return res.json({
      success: true,
      message: "Email updated successfully"
    });

  } catch (err) {
    console.error("UPDATE EMAIL ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// 📌 GET WALLET DATA (WITH USERNAME)
router.get("/wallet-data/:username", async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Username required"
    });
  }

  try {

    const userRows = await db.queryAsync(
      "SELECT num_views FROM user WHERE username = ? LIMIT 1",
      [username]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const settingsRows = await db.queryAsync(
      "SELECT client_rate, dollar_rate FROM payout_settings LIMIT 1"
    );

    if (!settingsRows || settingsRows.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Payout settings missing"
      });
    }

    const coins = Number(userRows[0].num_views) || 0;
    const client_rate = (Number(settingsRows[0].client_rate) || 0) / 1000;
    const dollar_rate = Number(settingsRows[0].dollar_rate) || 0;

    return res.json({
      success: true,
      coins,
      client_rate,
      dollar_rate
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// withdraw-payment

router.post("/withdraw-payment", async (req, res) => {
  const {
    username,
    bank_name,
    account_holder_name,
    account,
    coins,
    usd,
    pkr
  } = req.body;

  if (!username || !account || !coins) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields"
    });
  }

  try {

    const result = await db.withTransaction(async (conn) => {

      // =========================
      // USER CHECK + LOCK
      // =========================
      const [userResult] = await conn.query(
        "SELECT num_views FROM user WHERE username = ? FOR UPDATE",
        [username]
      );

      if (userResult.length === 0) {
        return { error: "USER_NOT_FOUND" };
      }

      const numViews = userResult[0].num_views;

      // =========================
      // BALANCE CHECK
      // =========================
      if (numViews < coins) {
        return { error: "INSUFFICIENT" };
      }

      const updatedViews = numViews - coins;

      // =========================
      // UPDATE USER BALANCE
      // =========================
      await conn.query(
        "UPDATE user SET num_views = ? WHERE username = ?",
        [updatedViews, username]
      );

      const safeUsd = usd ?? 0;
      const safePkr = pkr ?? 0;

      // =========================
      // SAVE PAYMENT HISTORY
      // =========================
      const [insertResult] = await conn.query(
        `INSERT INTO payment_history
        (username, bank_name, bank_account_number, account_holder_name, coins, amount_pkr, amount_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          username,
          bank_name,
          account,
          account_holder_name,
          coins,
          safePkr,
          safeUsd
        ]
      );

      return {
        success: true,
        updatedViews,
        paymentId: insertResult.insertId
      };

    });

    // =========================
    // ERROR HANDLING
    // =========================
    if (!result) {
      return res.status(500).json({
        success: false,
        message: "Server error"
      });
    }

    if (result.error === "USER_NOT_FOUND") {
      return res.json({
        success: false,
        message: "User not found"
      });
    }

    if (result.error === "INSUFFICIENT") {
      return res.json({
        success: false,
        message: "Insufficient balance"
      });
    }

    // =========================
    // ADMIN NOTIFICATION DB (OUTSIDE TRANSACTION)
    // =========================
    await db.queryAsync(
  `INSERT INTO admin_notifications
  (title, message, type, reference_id, is_read)
  VALUES (?, ?, ?, ?, 0)`,
  [
    "New Withdrawal Request",
    `${username} requested withdrawal of ${pkr} pkr`,
    "withdraw",
    result.paymentId
  ]
);

    // =========================
    // SOCKET NOTIFICATION
    // =========================
   const ioInstance = socket.getIO();

if (ioInstance) {
  ioInstance.emit("admin_notification", {
    title: "New Withdrawal Request",
    message: `${username} requested withdrawal`,
    type: "withdraw",
    reference_id: result.paymentId
  });
}
// =========================
// FIREBASE PUSH (ALL ADMINS)
// =========================
// =========================
// FIREBASE PUSH (ALL ADMINS)
// =========================
const resultTokens = await db.queryAsync(
  `SELECT DISTINCT fcm_token
   FROM admin_fcm_tokens
   WHERE fcm_token IS NOT NULL`
);

await Promise.all(
  resultTokens.map(async (row) => {

    if (!row.fcm_token) return;

    try {

      await admin.messaging().send({
        token: row.fcm_token,

        notification: {
          title: "New Withdrawal Request",
          body: `${username} requested withdrawal of ${pkr} PKR`
        },

        webpush: {
          notification: {
            icon: "https://ythub.lat/logo192.png"
          }
        }

      });

    } catch (err) {

      console.error(
        "Push failed:",
        err.message
      );

      // Invalid token auto delete
      if (
        err.code ===
        "messaging/registration-token-not-registered"
      ) {

        await db.queryAsync(
          `DELETE FROM admin_fcm_tokens
           WHERE fcm_token = ?`,
          [row.fcm_token]
        );

        console.log(
          "Invalid token removed:",
          row.fcm_token
        );
      }

    }

  })
);
    // =========================
    // RESPONSE
    // =========================
    return res.json({
      success: true,
      message: "Withdraw successful",
      num_views: result.updatedViews,
      payment_id: result.paymentId
    });

  } catch (err) {

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });

  }
});

//payment history

router.get("/payment-history/:username", async (req, res) => {

  const { username } = req.params;

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Username required"
    });
  }

  try {

    const rows = await db.queryAsync(
      `SELECT 
        id,
        bank_name,
        account_holder_name,
        bank_account_number AS account,
        coins,
        amount_usd,
        amount_pkr,
        status,
        created_at
      FROM payment_history
      WHERE username = ?
      ORDER BY id DESC`,
      [username]
    );

    return res.json(rows || []);

  } catch (err) {

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});
// POST: /user/change-password
router.post("/change-password", async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;

  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "All fields are required."
    });
  }

  try {

    const userResult = await db.queryAsync(
      "SELECT password FROM user WHERE username = ? LIMIT 1",
      [username]
    );

    if (!userResult || userResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    const dbPassword = userResult[0].password;

    const isMatch = await bcrypt.compare(oldPassword, dbPassword);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Old password is incorrect."
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters."
      });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await db.queryAsync(
      "UPDATE user SET password = ? WHERE username = ?",
      [hashedNewPassword, username]
    );

    return res.json({
      success: true,
      message: "Password changed successfully."
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Internal server error."
    });
  }
});

module.exports = router;
