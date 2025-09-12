const express = require("express");

const router = express.Router();
const db = require("../config/db"); // MySQL Connection


// Example Protected Route
//router.get("/profile", protectUser, (req, res) => {
 // res.json({ success: true, user: req.session.user });
//});



// 🛠 Check if user exists
// 🛠 Check if user exists
router.post("/check-user", async (req, res) => {
  const { username } = req.body;

  if (!username || typeof username !== "string" || username.trim() === "") {
    return res.status(400).json({ success: false, message: "Username is required and must be a string." });
  }

  try {
    const results = await db.queryAsync("SELECT 1 FROM user WHERE username = ? LIMIT 1", [username]);
    return res.json({ exists: results.length > 0 });
  } catch (err) {
    console.error("❌ Database Error in /check-user:", err.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});


// 🛠 Add user and create profile table
router.post("/add-user", async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required." });
  }

  // ✅ Sanitize username
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ success: false, message: "Invalid username format." });
  }

  try {
    // ✅ Check if username already exists
    const existingUsers = await db.queryAsync("SELECT * FROM user WHERE username = ?", [username]);

    if (existingUsers.length > 0) {
      return res.json({ success: false, message: "Username already exists." });
    }

    // ✅ Insert user into main user table
    await db.queryAsync("INSERT INTO user (username, num_views) VALUES (?, ?)", [username, 0]);

    // ✅ Create profile_[username] table safely
    const profileTable = `profile_${username}`;
    const createProfileTableSQL = `
      CREATE TABLE IF NOT EXISTS \`${profileTable}\` (
        order_id INT PRIMARY KEY,
        video_link VARCHAR(500),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await db.queryAsync(createProfileTableSQL);

    return res.json({ success: true, message: "User added and profile table created with order_id as PRIMARY KEY." });

  } catch (err) {
    console.error("❌ API Error in /add-user:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// 🛠 Get all users
router.get("/get-users", async (req, res) => {
  try {
    const results = await db.queryAsync("SELECT username, num_views FROM user");
    res.json(results);
  } catch (err) {
    console.error("❌ Error in /get-users:", err.message);
    res.status(500).json({ error: "Failed to fetch users." });
  }
});



// 🛠 Delete user and associated profile table

// 🛠 Bulk Delete Users API
router.post("/delete-bulk", async (req, res) => {
  const { usernames } = req.body;

  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ error: "Invalid request. No users provided." });
  }

  const placeholders = usernames.map(() => "?").join(",");
  const deleteUsersQuery = `DELETE FROM user WHERE username IN (${placeholders})`;

  try {
    // Delete users from the 'user' table
    await db.queryAsync(deleteUsersQuery, usernames);

    // Drop profile tables
    await Promise.all(
      usernames.map((username) =>
        db.queryAsync(`DROP TABLE IF EXISTS profile_${username}`)
      )
    );

    res.json({ success: true, message: "Users and profile tables deleted successfully." });
  } catch (err) {
    console.error("Error deleting users or tables:", err);
    res.status(500).json({ error: "Error deleting users or profile tables." });
  }
});


router.post("/update-coins-bulk", async (req, res) => {
  const { usernames, coins, operation } = req.body;

  if (!usernames || usernames.length === 0 || isNaN(coins)) {
    return res.status(400).json({ error: "Invalid input data" });
  }

  try {
    const updateQuery = `
      UPDATE user 
      SET num_views = CASE 
        WHEN num_views - ? < 0 THEN num_views - ?  -- Allow negative values
        ELSE num_views - ?
      END
      WHERE username IN (?)`;

    await db.queryAsync(updateQuery, [coins, coins, coins, usernames]);

    return res.json({ success: true, message: "Coins updated successfully!" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});



// get num of watch video
router.get("/num-views/:username", async (req, res) => {
  const { username } = req.params;

  try {
    // Use promise-based query to fetch num_views
    const [user] = await db.queryAsync("SELECT num_views FROM user WHERE username = ?", [username]);

    if (user) {
      res.json({ success: true, num_views: user.num_views });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  } catch (err) {
    console.error("❌ Error fetching num_views:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// when video watch one add

router.post("/increment-views", async (req, res) => {
  const { username, points, order_id } = req.body;

  // Basic validation
  if (!username || points === undefined || !order_id) {
    return res.status(400).json({
      success: false,
      message: "Username, points, and order_id are required",
    });
  }

  if (isNaN(points) || points <= 0) {
    return res.status(400).json({
      success: false,
      message: "Points must be a positive number",
    });
  }

  let conn;
  try {
    conn = await db.getConnection(); // ✅ Transaction start
    await new Promise((resolve, reject) =>
      conn.beginTransaction((err) => (err ? reject(err) : resolve()))
    );

    // ✅ Step 1: Increment user num_views
    const updateResult = await db.queryAsync(
      "UPDATE user SET num_views = num_views + ? WHERE username = ?",
      [points, username]
    );

    if (updateResult.affectedRows === 0) {
      conn.release();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ Step 2: Fetch updated num_views
    const users = await db.queryAsync(
      "SELECT num_views FROM user WHERE username = ?",
      [username]
    );

    if (users.length === 0) {
      conn.release();
      return res.status(404).json({
        success: false,
        message: "User not found after update",
      });
    }

    // ✅ Step 3: Decrement order remaining (first check orders, then temp_orders)
    const ordersResult = await db.queryAsync(
      "UPDATE orders SET remaining = remaining - 1 WHERE order_id = ? AND remaining > 0",
      [order_id]
    );

    if (ordersResult.affectedRows === 0) {
      // If not in orders, try temp_orders
      await db.queryAsync(
        "UPDATE temp_orders SET remaining = remaining - 1 WHERE order_id = ? AND remaining > 0",
        [order_id]
      );
    }

    // ✅ Commit
    await new Promise((resolve, reject) =>
      conn.commit((err) => (err ? reject(err) : resolve()))
    );

    conn.release();

    res.json({
      success: true,
      num_views: users[0].num_views,
      message: `Views increased by ${points}, remaining decremented for order ${order_id}`,
    });
  } catch (error) {
    console.error("❌ Error incrementing num_views:", error);

    if (conn) {
      await new Promise((resolve) => conn.rollback(() => resolve()));
      conn.release();
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});





module.exports = router;
