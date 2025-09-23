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
  let conn;

  try {
    // MariaDB compatible: dedicated connection for transaction
    conn = await db.getConnection();
    const query = (sql, params = []) =>
      new Promise((resolve, reject) => {
        conn.query(sql, params, (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });

    // start transaction
    await new Promise((resolve, reject) => conn.beginTransaction(err => (err ? reject(err) : resolve())));

    // fetch one order (MariaDB compatible)
    const orders = await query(
      `SELECT o.*
       FROM orders o
       LEFT JOIN \`${profileTable}\` p
         ON o.order_id = p.order_id
         OR o.video_link = p.video_link
         OR (o.channel_name IS NOT NULL AND o.channel_name = p.channel_name)
       LEFT JOIN order_ip_tracking ipt
         ON o.channel_name = ipt.channel_name
         AND ipt.ip_address = ?
       WHERE p.order_id IS NULL
         AND p.video_link IS NULL
         AND p.channel_name IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM order_ip_tracking i2
           WHERE i2.order_id = o.order_id AND i2.ip_address = ?
         )
         AND (ipt.count IS NULL OR ipt.count < 3)
         AND o.delay = 1
       ORDER BY o.id ASC
       LIMIT 1
       FOR UPDATE`,
      [ip, ip]
    );

    if (!orders || orders.length === 0) {
      await new Promise((resolve, reject) => conn.commit(err => (err ? reject(err) : resolve())));
      return res.status(200).json({ success: false, message: "No new orders found" });
    }

    const order = orders[0];
    const channelName = order.channel_name || null;
    const currentRemaining = parseInt(order.remaining, 10) || 0;

    // double-check profile table
    const existingProfile = await query(
      `SELECT 1 FROM \`${profileTable}\` WHERE order_id = ? OR video_link = ? OR channel_name = ?`,
      [order.order_id, order.video_link, channelName]
    );

    if (existingProfile.length > 0) {
      await new Promise((resolve, reject) => conn.rollback(err => (err ? reject(err) : resolve())));
      return res.status(409).json({ success: false, message: "Order already processed" });
    }

    // update or insert IP tracking
    const existingIP = await query(
      `SELECT * FROM order_ip_tracking WHERE channel_name <=> ? AND ip_address = ?`,
      [channelName, ip]
    );

    if (existingIP.length > 0) {
      await query(
        `UPDATE order_ip_tracking SET count = count + 1, timestamp = NOW() WHERE channel_name <=> ? AND ip_address = ?`,
        [channelName, ip]
      );
    } else {
      await query(
        `INSERT INTO order_ip_tracking (order_id, channel_name, ip_address, count, timestamp) VALUES (?, ?, ?, 1, NOW())`,
        [order.order_id, channelName, ip]
      );
    }

    // handle remaining logic
    if (currentRemaining <= 0) {
      await query(
        `INSERT INTO complete_orders (order_id, video_link, channel_name, quantity, timestamp) VALUES (?, ?, ?, ?, NOW())`,
        [order.order_id, order.video_link, channelName, order.quantity]
      );
      await query(`DELETE FROM orders WHERE order_id = ?`, [order.order_id]);
      await query(`DELETE FROM order_delay WHERE order_id = ?`, [order.order_id]);
    } else {
      const delayPool = [45, 60, 75, 90, 120];
      const availableDelays = delayPool.filter(d => d !== Number(order.wait));
      const delaySeconds = availableDelays.length > 0
        ? availableDelays[Math.floor(Math.random() * availableDelays.length)]
        : delayPool[Math.floor(Math.random() * delayPool.length)];

      await query(
        `INSERT INTO temp_orders (order_id, video_link, channel_name, quantity, remaining, delay, type, duration, wait, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [order.order_id, order.video_link, channelName, order.quantity, currentRemaining, order.delay, order.type, order.duration, delaySeconds, delaySeconds]
      );

      await query(`DELETE FROM orders WHERE order_id = ?`, [order.order_id]);
    }

    // save to profile table
    await query(
      `INSERT INTO \`${profileTable}\` (order_id, video_link, channel_name, timestamp) VALUES (?, ?, ?, NOW())`,
      [order.order_id, order.video_link, channelName]
    );

    // commit transaction
    await new Promise((resolve, reject) => conn.commit(err => (err ? reject(err) : resolve())));

    return res.status(200).json({ success: true, order });

  } catch (error) {
    console.error("❌ Error in /fetch-order:", error);
    try {
      if (conn) await new Promise((resolve, reject) => conn.rollback(err => (err ? reject(err) : resolve())));
    } catch (rbErr) {
      console.error("❌ Rollback failed:", rbErr);
    }
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  } finally {
    try {
      if (conn) conn.release();
    } catch (releaseErr) {
      console.error("❌ conn.release() failed:", releaseErr);
    }
  }
});




// API 1 - Receive Data from user and Save to pending_orders
router.post('/process', async (req, res) => {
  const { data } = req.body;

  // Validate that data is a non-empty array
  if (!data || !Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid data format' });
  }

  const chunkSize = 4; // Split into groups of 4
  const chunks = [];

  // Chunk the data into sets of 4
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }

  // Added 'duration' column
  const insertPending = `
    INSERT INTO pending_orders (order_id, video_link, quantity, remaining, duration)
    VALUES (?, ?, ?, ?, ?)
  `;

  const failedOrders = [];

  try {
    for (const chunk of chunks) {
      const [orderId, videoLink, quantity, duration] = chunk;

      const originalQuantity = parseInt(quantity || 0, 10);
      const additional = Math.ceil(originalQuantity * 0.15);
      const remaining = originalQuantity + additional;

      // Duration parsing with default 60
      let durationValue = parseInt(duration, 10);
      if (isNaN(durationValue) || durationValue <= 0) {
        durationValue = 60;
      }

      try {
        await db.queryAsync(insertPending, [
          orderId,
          videoLink,
          originalQuantity,
          remaining,
          durationValue
        ]);
      } catch (err) {
        console.warn(`Skipping duplicate or error for orderId: ${orderId}`, err.message);
        failedOrders.push(orderId || 'unknown');
      }
    }

    res.json({
      success: true,
      message: 'Data processed. Some entries may have been skipped.',
      failedOrders,
    });

  } catch (err) {
    console.error('Unexpected server error:', err);
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






