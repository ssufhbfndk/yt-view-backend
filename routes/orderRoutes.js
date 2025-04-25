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



router.post('/invalid-video', async (req, res) => {
  const { order_id, video_link } = req.body;

  console.log("📌 Received request to mark video as invalid:", { order_id, video_link });

  if (!order_id || !video_link) {
    console.log("❌ Missing order_id or video_link");
    return res.status(400).json({ success: false, message: "Missing order_id or video_link" });
  }

  let connection;
  try {
    connection = await db.getConnection(); // ✅ Get a connection from the pool
    

    await new Promise((resolve, reject) => connection.beginTransaction(err => err ? reject(err) : resolve()));
   

    // Step 1: Check if the order exists in `orders`
    const orderFromOrders = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT order_id, video_link, quantity FROM orders WHERE order_id = ? OR video_link = ? LIMIT 1`,
        [order_id, video_link],
        (err, results) => (err ? reject(err) : resolve(results))
      );
    });

    // Step 2: Check if the order exists in `temp_orders`
    const orderFromTemp = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT order_id, video_link, quantity FROM temp_orders WHERE order_id = ? OR video_link = ? LIMIT 1`,
        [order_id, video_link],
        (err, results) => (err ? reject(err) : resolve(results))
      );
    });

    let orderDetails = null;
    let tableToDelete = null;

    if (orderFromOrders.length > 0 && orderFromTemp.length > 0) {
      console.log("⚠️ Order found in both tables! This should not happen.");
      await new Promise((resolve, reject) => connection.rollback(err => err ? reject(err) : resolve()));
      connection.release();
      return res.status(500).json({ success: false, message: "Data inconsistency: order exists in both tables." });
    } else if (orderFromOrders.length > 0) {
      orderDetails = orderFromOrders[0];
      tableToDelete = "orders";
    } else if (orderFromTemp.length > 0) {
      orderDetails = orderFromTemp[0];
      tableToDelete = "temp_orders";
    } else {
      console.log("⚠️ Order not found in orders or temp_orders");
      await new Promise((resolve, reject) => connection.rollback(err => err ? reject(err) : resolve()));
      connection.release();
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    

    // Step 3: Delete from the correct table
    await new Promise((resolve, reject) => {
      connection.query(
        `DELETE FROM ${tableToDelete} WHERE order_id = ? OR video_link = ?`,
        [order_id, video_link],
        (err, results) => (err ? reject(err) : resolve(results))
      );
    });

    

    // Step 4: Move to `invalid_videos` table
    await new Promise((resolve, reject) => {
      connection.query(
        `INSERT INTO invalid_videos (order_id, video_link, quantity, error_type, timestamp) VALUES (?, ?, ?, ?, NOW())`,
        [orderDetails.order_id, orderDetails.video_link, orderDetails.quantity, "unavailable"],
        (err, results) => (err ? reject(err) : resolve(results))
      );
    });



    await new Promise((resolve, reject) => connection.commit(err => err ? reject(err) : resolve()));
   

    connection.release();

    res.status(200).json({
      success: true,
      message: "Order marked as invalid and moved to invalid_videos table",
      data: {
        order_id: orderDetails.order_id,
        video_link: orderDetails.video_link,
        quantity: orderDetails.quantity,
        error_type: "unavailable",
      },
    });
  } catch (error) {
    console.error("❌ Error processing invalid video:", error);

    if (connection) {
      await new Promise((resolve, reject) => connection.rollback(err => err ? reject(err) : resolve()));
      connection.release();
    }

    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
});


router.post('/process', async (req, res) => {
  const { data } = req.body;

  const chunkSize = 3;
  const chunks = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }

  let successCount = 0;
  let errorCount = 0;
  let invalidCount = 0;

  const isYouTubeVideoLink = (url) => {
    const regExp = /^(https?\:\/\/)?(www\.youtube\.com|youtu\.be)\/(watch\?v=|embed\/)?([a-zA-Z0-9_-]{11})/;
    return regExp.test(url);
  };

  const getYouTubeVideoId = (url) => {
    const match = url.match(/[?&]v=([^&#]*)|youtu\.be\/([^&#]*)|embed\/([^&#]*)/);
    return match ? match[1] || match[2] || match[3] : null;
  };

  const isValidYouTubeVideo = async (videoId) => {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}&key=${YOUTUBE_API_KEY}`;
    try {
      const response = await axios.get(url);
      const item = response.data.items[0];
      if (!item) return false;
      const status = item.status;
      return status.embeddable && status.privacyStatus === 'public';
    } catch (err) {
      console.error('YouTube API error:', err.message);
      return false;
    }
  };

  try {
    for (const chunk of chunks) {
      const [orderId, videoLink, quantity] = chunk;
      const originalQuantity = parseInt(quantity);
      const additional = Math.ceil(originalQuantity * 0.15);
      const remaining = originalQuantity + additional;

      // Check duplicate in DB
      const checkQuery = 'SELECT * FROM orders WHERE order_id = ? OR video_link = ?';
      const existingOrders = await db.queryAsync(checkQuery, [orderId, videoLink]);

      if (existingOrders.length > 0) {
        const errorQuery = 'INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp) VALUES (?, ?, ?, ?, NOW())';
        await db.queryAsync(errorQuery, [orderId, videoLink, originalQuantity, remaining]);
        errorCount++;
        continue;
      }

      // Check if YouTube link is valid
      if (!isYouTubeVideoLink(videoLink)) {
        const errorQuery = 'INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp) VALUES (?, ?, ?, ?, NOW())';
        await db.queryAsync(errorQuery, [orderId, videoLink, originalQuantity, remaining]);
        errorCount++;
        continue;
      }

      const videoId = getYouTubeVideoId(videoLink);
      const validVideo = await isValidYouTubeVideo(videoId);

      if (!validVideo) {
        const invalidQuery = 'INSERT INTO invalid_orders (order_id, video_link, quantity, remaining, timestamp) VALUES (?, ?, ?, ?, NOW())';
        await db.queryAsync(invalidQuery, [orderId, videoLink, originalQuantity, remaining]);
        invalidCount++;
        continue;
      }

      const insertQuery = 'INSERT INTO orders (order_id, video_link, quantity, remaining) VALUES (?, ?, ?, ?)';
      await db.queryAsync(insertQuery, [orderId, videoLink, originalQuantity, remaining]);
      successCount++;
    }

    res.json({ success: true, inserted: successCount, errors: errorCount, invalid: invalidCount });
  } catch (err) {
    console.error("Error processing orders:", err);
    res.status(500).json({ message: 'Server error' });
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






