const express = require('express');
const router = express.Router();
const db = require('../config/db');  // Assuming db.js is where your MySQL connection is set up

// Process data from frontend
const axios = require('axios');
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

router.get("/fetch-order/:username", async (req, res) => {
  const { username } = req.params;

  if (!username.match(/^[a-zA-Z0-9_]+$/)) {
    return res.status(400).json({ success: false, message: "Invalid username" });
  }

  const profileTable = `profile_${username}`;
  let connection;

  try {
    connection = await db.getConnection();
    const conn = connection.promise(); // 🟢 Use promise wrapper for async/await

    await conn.query("START TRANSACTION");

    // 🟢 Step 1: Get a random order that is NOT in the user’s profile table
    const [orders] = await conn.query(`
      SELECT o.* FROM orders o 
      LEFT JOIN ${profileTable} p ON o.order_id = p.order_id 
      WHERE p.order_id IS NULL 
      ORDER BY RAND() 
      LIMIT 1
    `);

    if (orders.length === 0) {
      await conn.query("COMMIT"); // Commit to close transaction gracefully
      connection.release();
      return res.status(200).json({ success: false, message: "No new orders found" });
    }

    const randomOrder = orders[0];

    // 🟢 Step 2: Handle based on remaining count
    if (randomOrder.remaining <= 1) {
      await conn.query(
        `INSERT INTO complete_orders (order_id, video_link, quantity, timestamp) VALUES (?, ?, ?, NOW())`,
        [randomOrder.order_id, randomOrder.video_link, randomOrder.quantity]
      );
    } else {
      await conn.query(
        `INSERT INTO temp_orders (order_id, video_link, quantity, remaining, timestamp) VALUES (?, ?, ?, ?, NOW())`,
        [randomOrder.order_id, randomOrder.video_link, randomOrder.quantity, randomOrder.remaining - 1]
      );
    }

    // 🟢 Step 3: Remove from orders table
    await conn.query(`DELETE FROM orders WHERE order_id = ?`, [randomOrder.order_id]);

    // 🟢 Step 4: Add to user's profile table
    await conn.query(
      `INSERT INTO ${profileTable} (order_id, timestamp) VALUES (?, NOW())`,
      [randomOrder.order_id]
    );

    await conn.query("COMMIT");
    connection.release();

    res.status(200).json({ success: true, order: randomOrder });
  } catch (error) {
    console.error("❌ Error processing order:", error);

    if (connection) {
      try {
        await connection.promise().query("ROLLBACK");
        connection.release();
      } catch (rollbackError) {
        console.error("❌ Rollback failed:", rollbackError);
      }
    }

    res.status(500).json({ success: false, message: "Internal Server Error" });
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
  try {
    // Query to get orders from the 'orders' table
    const ordersQuery = 'SELECT order_id, video_link, quantity, remaining, "orders" AS tableName FROM orders';
    const tempOrdersQuery = 'SELECT order_id, video_link, quantity, remaining, "temp_orders" AS tableName FROM temp_orders';

    // Execute both queries
    db.query(ordersQuery + ' UNION ' + tempOrdersQuery, (err, result) => {
      if (err) {
        return res.status(500).json({ message: 'Error fetching orders from database' });
      }
      res.json({ orders: result });
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// routes/orders.js
// Delete order from 'orders' or 'temp_orders' table
router.delete('/ordersData/:orderId', async (req, res) => {
  const { orderId } = req.params;

  if (!orderId) {
    return res.status(400).json({ message: 'Order ID is required' });
  }

  try {
    const tables = ['orders', 'temp_orders'];

    // Check both tables for the order
    for (const table of tables) {
      const checkQuery = `SELECT * FROM ${table} WHERE order_id = ? LIMIT 1`;

      const [rows] = await db.promise().query(checkQuery, [orderId]);

      if (rows.length > 0) {
        // If found, delete from this table
        const deleteQuery = `DELETE FROM ${table} WHERE order_id = ?`;
        await db.promise().query(deleteQuery, [orderId]);

        return res.json({ success: true, message: `Order deleted from ${table}` });
      }
    }

    // If not found in either table
    return res.status(404).json({ message: 'Order not found in orders or temp_orders' });

  } catch (err) {
    console.error("Delete order error:", err);
    return res.status(500).json({ message: 'Server error' });
  }
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






