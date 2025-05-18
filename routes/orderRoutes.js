const express = require('express');
const router = express.Router();
const db = require('../config/db');  // Assuming db.js is where your MySQL connection is set up

// Process data from frontend
const axios = require('axios');
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

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

    // 1️⃣ Select a random order NOT in user's profile and IP count < 5
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

    // 2️⃣ Update or insert IP tracking
    const [existingIP] = await conn.query(
      `SELECT * FROM order_ip_tracking WHERE order_id = ? AND ip_address = ?`,
      [order.order_id, ip]
    );

    if (existingIP.length > 0) {
      await conn.query(
        `UPDATE order_ip_tracking SET count = count + 1 WHERE order_id = ? AND ip_address = ?`,
        [order.order_id, ip]
      );
    } else {
      await conn.query(
        `INSERT INTO order_ip_tracking (order_id, ip_address, count) VALUES (?, ?, 1)`,
        [order.order_id, ip]
      );
    }

    // 3️⃣ Update or insert user pick count
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

    // 4️⃣ Check updated user_count
    const [updatedPick] = await conn.query(
      `SELECT user_count FROM order_user_pick_count WHERE order_id = ?`,
      [order.order_id]
    );

    if (updatedPick.length > 0 && updatedPick[0].user_count >= 3) {
      const newRemaining = order.remaining - 1;

      if (newRemaining <= 0) {
        // remaining 0: Move to complete_orders, delete from orders and order_user_pick_count
        await conn.query(
          `INSERT INTO complete_orders (order_id, video_link, quantity, timestamp)
           VALUES (?, ?, ?, NOW())`,
          [order.order_id, order.video_link, order.quantity]
        );

        await conn.query(`DELETE FROM orders WHERE order_id = ?`, [order.order_id]);

        await conn.query(`DELETE FROM order_user_pick_count WHERE order_id = ?`, [order.order_id]);

      } else {
        // remaining > 0: Insert into temp_orders, delete from orders
        await conn.query(
          `INSERT INTO temp_orders (order_id, video_link, quantity, remaining, timestamp)
           VALUES (?, ?, ?, ?, NOW())`,
          [order.order_id, order.video_link, order.quantity, newRemaining]
        );

        await conn.query(`DELETE FROM orders WHERE order_id = ?`, [order.order_id]);

        // **Note:** Do NOT delete order_user_pick_count here, keep it for temp_orders
      }

    } else {
      // user_count < 3: Just decrement remaining in orders
      await conn.query(
        `UPDATE orders SET remaining = remaining - 1 WHERE order_id = ?`,
        [order.order_id]
      );
    }

    // 5️⃣ Insert into user's profile table
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

//order save tu db


// Helper: YouTube ID extractor
const getYouTubeVideoId = (url) => {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace('www.', '');

    if (hostname === 'youtu.be') {
      return parsedUrl.pathname.slice(1);
    }

    if (hostname === 'youtube.com') {
      if (parsedUrl.pathname === '/watch') {
        return parsedUrl.searchParams.get('v');
      }

      // Handle Shorts
      if (parsedUrl.pathname.startsWith('/shorts/')) {
        return parsedUrl.pathname.split('/')[2] || parsedUrl.pathname.split('/')[1];
      }

      // Handle Live
      if (parsedUrl.pathname.startsWith('/live/')) {
        return parsedUrl.pathname.split('/')[2] || parsedUrl.pathname.split('/')[1];
      }

      // Handle Embed
      if (parsedUrl.pathname.startsWith('/embed/')) {
        return parsedUrl.pathname.split('/')[2] || parsedUrl.pathname.split('/')[1];
      }

      // Handle /v/VIDEO_ID format
      if (parsedUrl.pathname.startsWith('/v/')) {
        return parsedUrl.pathname.split('/')[2] || parsedUrl.pathname.split('/')[1];
      }
    }

    return null;
  } catch (e) {
    console.error('❌ Error parsing YouTube URL:', e.message);
    return null;
  }
};


// Helper: Validate with YouTube API
const isValidYouTubeVideo = async (videoId) => {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=status,player,snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;
  try {
    const response = await axios.get(url);
    const item = response.data.items[0];
    if (!item) {
      return { valid: false, reason: 'Video not found' };
    }

    const { status, player, snippet } = item;

    // Check embeddable
    if (!status.embeddable) {
      return { valid: false, reason: 'Video not embeddable' };
    }

    // Check privacy public hai
    if (status.privacyStatus !== 'public') {
      return { valid: false, reason: `Video privacy: ${status.privacyStatus}` };
    }

    // Check player HTML se "Video unavailable" na ho
    if (player.embedHtml.includes('Video unavailable')) {
      return { valid: false, reason: 'Embed shows video unavailable' };
    }

    // Check agar video currently live hai
    if (snippet.liveBroadcastContent === 'live') {
      return { valid: false, reason: 'Currently Live Video not allowed' };
    }

    // Sab pass ho gaya
    return { valid: true };
  } catch (err) {
    console.error('YouTube API error:', err.response?.data || err.message);
    return { valid: false, reason: err.response?.data?.error?.message || err.message };
  }
};


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


// Background Function - Process pending orders
const processPendingOrders = async () => {
  try {
    // Step 1 - Fetch pending_orders
    const pending = await db.queryAsync('SELECT * FROM pending_orders ORDER BY id ASC');

    console.log('Pending orders fetched:', pending);

    if (!pending || !Array.isArray(pending) || pending.length === 0) {
      console.log('No pending orders found.');
      return;
    }

    console.log(`Found ${pending.length} pending orders. Processing...`);

    // Step 2 - Process each order one by one
    for (const order of pending) {
      try {
        const { id, order_id, video_link, quantity, remaining } = order;

        // Step 2.1 - Basic YouTube URL check
        const videoId = getYouTubeVideoId(video_link);

        if (!videoId) {
          await db.queryAsync(`
            INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp)
            VALUES (?, ?, ?, ?, NOW())
          `, [order_id, video_link, quantity, remaining]);

          await db.queryAsync('DELETE FROM pending_orders WHERE id = ?', [id]);
          console.log(`Invalid YouTube link format: ${video_link}`);
          await delay(2000); // 2 second delay
          continue;
        }

        // Step 2.2 - Duplicate Check in orders and temp_orders
        const existing = await db.queryAsync(`
          SELECT order_id FROM orders WHERE order_id = ? OR video_link = ?
          UNION
          SELECT order_id FROM temp_orders WHERE order_id = ? OR video_link = ?
        `, [order_id, video_link, order_id, video_link]);

        if (existing && existing.length > 0) {
          await db.queryAsync(`
            INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp)
            VALUES (?, ?, ?, ?, NOW())
          `, [order_id, video_link, quantity, remaining]);

          await db.queryAsync('DELETE FROM pending_orders WHERE id = ?', [id]);
          console.log(`Duplicate entry found for: ${order_id}`);
          await delay(2000); // 2 second delay
          continue;
        }

        // Step 2.3 - Validate with YouTube API
        const { valid, reason } = await isValidYouTubeVideo(videoId);

        if (!valid) {
          await db.queryAsync(`
            INSERT INTO invalid_orders (order_id, video_link, quantity, remaining, error_reason, timestamp)
            VALUES (?, ?, ?, ?, ?, NOW())
          `, [order_id, video_link, quantity, remaining, reason]);

          await db.queryAsync('DELETE FROM pending_orders WHERE id = ?', [id]);
          console.log(`Invalid YouTube Video: ${video_link} - ${reason}`);
          await delay(2000); // 2 second delay
          continue;
        }

        // Step 2.4 - Insert into orders table
        await db.queryAsync(`
          INSERT INTO orders (order_id, video_link, quantity, remaining)
          VALUES (?, ?, ?, ?)
        `, [order_id, video_link, quantity, remaining]);

        await db.queryAsync('DELETE FROM pending_orders WHERE id = ?', [id]);
        console.log(`Order inserted successfully: ${order_id}`);

        // 2 seconds delay after successful processing
        await delay(2000);

      } catch (innerError) {
        console.error(`❌ Error processing order:`, innerError);
        await delay(2000); // Still wait 2 seconds even if error
        continue; // Go to next order
      }
    }

    console.log('✅ All pending orders processed.');

  } catch (err) {
    console.error('❌ Error fetching pending orders:', err);
  }
};

// Helper function for 2-second delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Auto-run pending orders every 5 min
setInterval(processPendingOrders, 300000); // 5 minutes






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


// Process orders every 1 minute
let isProcessing = false;

setInterval(async () => {
  if (isProcessing) return;
  isProcessing = true;

  console.log("⏳ Checking temp_orders for processing...");

  let connection;

  try {
    connection = await db.getConnection();

    // Use the promise wrapper for async/await
    const conn = connection.promise();

    await conn.query('START TRANSACTION');

    // Select eligible orders
    const [tempOrders] = await conn.query(`
      SELECT * FROM temp_orders
      WHERE TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= 60
      FOR UPDATE
    `);

    if (tempOrders.length === 0) {
      console.log("✅ No temp orders to process.");
      await conn.query('COMMIT');
      return;
    }

    for (const tempOrder of tempOrders) {
      const { order_id, video_link, quantity, remaining } = tempOrder;

      if (remaining > 0) {
        await conn.query(`
          INSERT INTO orders (order_id, video_link, quantity, remaining)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE remaining = VALUES(remaining)
        `, [order_id, video_link, quantity, remaining]);

        console.log(`🔄 Order ${order_id} moved back to orders table.`);
      } else {
        await conn.query(`
          INSERT INTO complete_orders (order_id, video_link, quantity, timestamp)
          VALUES (?, ?, ?, NOW())
        `, [order_id, video_link, quantity]);

        console.log(`✅ Order ${order_id} moved to complete_orders.`);
      }

      await conn.query(
        `DELETE FROM temp_orders WHERE order_id = ?`,
        [order_id]
      );

      console.log(`🗑️ Order ${order_id} removed from temp_orders.`);
    }

    await conn.query('COMMIT');
    console.log("🎉 All eligible temp_orders processed successfully.");
  } catch (error) {
    console.error("❌ Error during temp_orders processing:", error);
    if (connection) await connection.promise().query('ROLLBACK');
  } finally {
    if (connection) connection.release();
    isProcessing = false;
  }
}, 60000);


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






