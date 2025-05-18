const express = require('express');
const router = express.Router();
const db = require('../config/db');  // Assuming db.js is where your MySQL connection is set up


router.post("/fetch-order", async (req, res) => {
  const { username, ip } = req.body;

  if (!username || !ip) {
    return res.status(400).json({ success: false, message: "Username and IP required" });
  }

  if (!username.match(/^[a-zA-Z0-9_]+$/)) {
    return res.status(400).json({ success: false, message: "Invalid username" });
  }

  const profileTable = `profile_${username}`;
  let connection;

  try {
    connection = await db.getConnection();
    const conn = connection.promise();

    await conn.query("START TRANSACTION");

    // 1️⃣ Find order not used by this user and IP under 5
    const [orders] = await conn.query(`
      SELECT o.* FROM orders o
      LEFT JOIN ${profileTable} p ON o.order_id = p.order_id
      LEFT JOIN order_ip_tracking ipt ON o.order_id = ipt.order_id AND ipt.ip_address = ?
      WHERE p.order_id IS NULL
        AND (ipt.count IS NULL OR ipt.count < 5)
      ORDER BY RAND()
      LIMIT 1
    `, [ip]);

    if (orders.length === 0) {
      await conn.query("COMMIT");
      connection.release();
      return res.status(200).json({ success: false, message: "No new orders found" });
    }

    const order = orders[0];

    // 2️⃣ Update IP tracking
    const [existingIP] = await conn.query(
      `SELECT * FROM order_ip_tracking WHERE order_id = ? AND ip_address = ?`,
      [order.order_id, ip]
    );

    if (existingIP.length > 0) {
      await conn.query(
        `UPDATE order_ip_tracking SET count = count + 1, timestamp = NOW() WHERE order_id = ? AND ip_address = ?`,
        [order.order_id, ip]
      );
    } else {
      await conn.query(
        `INSERT INTO order_ip_tracking (order_id, ip_address, count, timestamp) VALUES (?, ?, 1, NOW())`,
        [order.order_id, ip]
      );
    }

    // 3️⃣ Update user pick count
    const [userPick] = await conn.query(
      `SELECT * FROM order_user_pick_count WHERE order_id = ?`,
      [order.order_id]
    );

    if (userPick.length > 0) {
      await conn.query(
        `UPDATE order_user_pick_count SET user_count = user_count + 1 WHERE order_id = ?`,
        [order.order_id]
      );
    } else {
      await conn.query(
        `INSERT INTO order_user_pick_count (order_id, user_count) VALUES (?, 1)`,
        [order.order_id]
      );
    }

    // 4️⃣ Fetch updated user_count
    const [updatedPick] = await conn.query(
      `SELECT user_count FROM order_user_pick_count WHERE order_id = ?`,
      [order.order_id]
    );

    if (updatedPick.length > 0 && updatedPick[0].user_count >= 3) {
      // remove from orders, move to temp or complete
      const newRemaining = order.remaining - 1;

      if (newRemaining <= 0) {
        await conn.query(
          `INSERT INTO complete_orders (order_id, video_link, quantity, timestamp)
           VALUES (?, ?, ?, NOW())`,
          [order.order_id, order.video_link, order.quantity]
        );

        await conn.query(`DELETE FROM orders WHERE order_id = ?`, [order.order_id]);
        await conn.query(`DELETE FROM order_user_pick_count WHERE order_id = ?`, [order.order_id]);

      } else {
        await conn.query(
          `INSERT INTO temp_orders (order_id, video_link, quantity, remaining, timestamp)
           VALUES (?, ?, ?, ?, NOW())`,
          [order.order_id, order.video_link, order.quantity, newRemaining]
        );

        await conn.query(`DELETE FROM orders WHERE order_id = ?`, [order.order_id]);
      }
    } else {
      // Less than 3 user picks: decrement remaining
      await conn.query(`UPDATE orders SET remaining = remaining - 1 WHERE order_id = ?`, [order.order_id]);
    }

    // 5️⃣ Add to user profile
    await conn.query(
      `INSERT INTO ${profileTable} (order_id, timestamp) VALUES (?, NOW())`,
      [order.order_id]
    );

    await conn.query("COMMIT");
    connection.release();

    res.status(200).json({ success: true, order });
  } catch (error) {
    console.error("❌ Error in fetch-order:", error);
    if (connection) {
      await connection.promise().query("ROLLBACK");
      connection.release();
    }
    res.status(500).json({ success: false, message: "Server Error" });
  }
});


// API 1 - Receive Data from user and Save to pending_orders
router.post('/process', async (req, res) => {
  const { data } = req.body;

  // Validate data to make sure it's not empty or malformed
  if (!data || !Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid data format' });
  }

  const chunkSize = 3;
  const chunks = [];

  // Chunking the data for batch processing
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }

  try {
    for (const chunk of chunks) {
      const [orderId, videoLink, quantity] = chunk;
      const originalQuantity = parseInt(quantity);
      const additional = Math.ceil(originalQuantity * 0.15);
      const remaining = originalQuantity + additional;

      const insertPending = `
        INSERT INTO pending_orders (order_id, video_link, quantity, remaining)
        VALUES (?, ?, ?, ?)
      `;

      // Awaiting db insertion for each chunk
      await db.queryAsync(insertPending, [orderId, videoLink, originalQuantity, remaining]);
    }

    // If everything succeeds, send success response
    res.json({ success: true, message: 'Data saved to pending_orders, will be processed shortly.' });

  } catch (err) {
    // Handling errors if the DB operation fails
    console.error('Error saving to pending_orders:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});


//////////////////////




// Get orders from both 'orders' and 'temp_orders' tables
router.get('/ordersData', async (req, res) => {
  const ordersQuery = `
    SELECT order_id, video_link, quantity, remaining, 'orders' AS tableName FROM orders
    UNION
    SELECT order_id, video_link, quantity, remaining, 'temp_orders' AS tableName FROM temp_orders
  `;

  try {
    const result = await db.queryAsync(ordersQuery);
    res.json({ orders: result });
  } catch (err) {
    console.error("❌ Error fetching orders:", err.message);
    res.status(500).json({ message: "Failed to fetch orders." });
  }
});


// routes/orders.js
// Delete order from 'orders' or 'temp_orders' table
router.delete('/ordersData/:orderId', (req, res) => {
  const { orderId } = req.params;

  if (!orderId) {
    return res.status(400).json({ message: 'Order ID is required' });
  }

  const tables = ['orders', 'temp_orders'];

  // Function to check and delete from each table recursively
  function checkAndDelete(index) {
    if (index >= tables.length) {
      return res.status(404).json({ message: 'Order not found in orders or temp_orders' });
    }

    const table = tables[index];
    const checkQuery = `SELECT * FROM ${table} WHERE order_id = ? LIMIT 1`;

    db.query(checkQuery, [orderId], (err, rows) => {
      if (err) {
        console.error("DB Error:", err);
        return res.status(500).json({ message: 'Database error' });
      }

      if (rows.length > 0) {
        // Order found, delete it
        const deleteQuery = `DELETE FROM ${table} WHERE order_id = ?`;
        db.query(deleteQuery, [orderId], (err2) => {
          if (err2) {
            console.error("Delete Error:", err2);
            return res.status(500).json({ message: 'Failed to delete order' });
          }

          return res.json({ success: true, message: `Order deleted from ${table}` });
        });
      } else {
        // Check next table
        checkAndDelete(index + 1);
      }
    });
  }

  checkAndDelete(0); // Start with first table
});



// Get orders from 'complete_orders' table
router.get('/ordersComplete', async (req, res) => {
  try {
    const query = 'SELECT * FROM complete_orders ORDER BY timestamp DESC';
    db.query(query, (err, result) => {
      if (err) {
        return res.status(500).json({ message: 'Error fetching completed orders' });
      }
      res.json({ orders: result });
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
});



// Delete order from 'complete_orders' table
router.delete('/deleteOrderComplete/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deleteQuery = 'DELETE FROM complete_orders WHERE id = ?';
    const result = await db.queryAsync(deleteQuery, [id]); // Correct usage of async/await

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (err) {
    console.error("Error deleting order:", err);
    res.status(500).json({ message: 'Server error' });
  }
});



///////////////////////////////////////////////////////////////


//funtion use every 1houre


const deleteOldOrders = async () => {
  try {
    console.log("🕒 Fetching all usernames...");

    // Step 1: Fetch all usernames from the user table
    const users = await db.queryAsync("SELECT username FROM user");

    if (!Array.isArray(users) || users.length === 0) {
      console.log("🚫 No users found. Skipping cleanup.");
      return;
    }

    const fixedTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago


    // Step 2: Loop through each user
    for (const user of users) {
      const { username } = user;
      const profileTable = `profile_${username}`; // Dynamic table name

      // Check if the profile table exists
      const checkTableQuery = `SHOW TABLES LIKE ?`;
      const tableExists = await db.queryAsync(checkTableQuery, [profileTable]);

      if (tableExists.length === 0) {
        console.log(`⚠️ Table ${profileTable} does not exist. Skipping.`);
        continue;
      }

      console.log(`🧹 Cleaning up old orders from ${profileTable}...`);

      // Step 3: Delete all orders older than the fixed time
      const deleteQuery = `DELETE FROM ?? WHERE timestamp < ?`;
      const result = await db.queryAsync(deleteQuery, [profileTable, fixedTime]);

      console.log(`✅ Deleted ${result.affectedRows} old orders from ${profileTable}`);
    }

    console.log("✅ Cleanup job completed!");
  } catch (error) {
    console.error("❌ Error deleting old orders:", error);
  }
};

// Run every hour (3600000 milliseconds = 1 hour)
setInterval(async () => {
  console.log("🕒 Running hourly cleanup job...");
  await deleteOldOrders();
}, 3600000);



module.exports = router;






