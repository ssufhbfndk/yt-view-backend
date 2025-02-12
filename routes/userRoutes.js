const express = require("express");

const router = express.Router();
const db = require("../config/db"); // MySQL Connection


// Example Protected Route
//router.get("/profile", protectUser, (req, res) => {
 // res.json({ success: true, user: req.session.user });
//});



// 🛠 Check if user exists
router.post("/check-user", (req, res) => {
  const { username } = req.body;

  db.query("SELECT * FROM user WHERE username = ?", [username], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    return res.json({ exists: results.length > 0 });
  });
});

// 🛠 Add user and create profile table
router.post("/add-user", (req, res) => {
  const { username } = req.body;

  // Check if username already exists
  db.query("SELECT * FROM user WHERE username = ?", [username], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length > 0) {
      return res.json({ success: false, message: "Username already exists." });
    }

   // Add user to 'user' table
db.query(
  "INSERT INTO user (username, num_views) VALUES (?, ?)", // Insert both username and num_views
  [username, 0], // Pass username and 0 as values
  (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

      // Create user-specific profile table
      const profileTable = `profile_${username}`;
      const createProfileTable = `
        CREATE TABLE IF NOT EXISTS ${profileTable} (
          order_id INT AUTO_INCREMENT PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      db.query(createProfileTable, (err) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json({ success: true, message: "User added and profile table created." });
      });
    });
  });
});

// 🛠 Get all users
router.get("/get-users", (req, res) => {
  db.query("SELECT username, num_views FROM user", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});


// 🛠 Delete user and associated profile table

// 🛠 Bulk Delete Users API
router.post("/delete-bulk", (req, res) => {
  const { usernames } = req.body;

  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ error: "Invalid request. No users provided." });
  }

  const placeholders = usernames.map(() => "?").join(",");
  const deleteUsersQuery = `DELETE FROM user WHERE username IN (${placeholders})`;

  db.query(deleteUsersQuery, usernames, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    let deleteProfileTables = usernames.map((username) => {
      return new Promise((resolve, reject) => {
        db.query(`DROP TABLE IF EXISTS profile_${username}`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    Promise.all(deleteProfileTables)
      .then(() => {
        res.json({ success: true, message: "Users and profiles deleted successfully." });
      })
      .catch((err) => res.status(500).json({ error: err.message }));
  });
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
  const { username } = req.body;

  try {
    // Use promise-based query to increment num_views
    const updateResult = await db.queryAsync(
      "UPDATE user SET num_views = num_views + 1 WHERE username = ?",
      [username]
    );

    // Check if the update was successful
    if (updateResult.affectedRows > 0) {
      // Fetch the updated num_views value
      const [user] = await db.queryAsync("SELECT num_views FROM user WHERE username = ?", [username]);

      if (user) {
        res.json({ success: true, num_views: user.num_views });
      } else {
        res.status(404).json({ success: false, message: "User not found after update" });
      }
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  } catch (err) {
    console.error("❌ Error incrementing num_views:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});
module.exports = router;
