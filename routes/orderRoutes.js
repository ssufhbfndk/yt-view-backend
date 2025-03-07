const express = require('express');
const router = express.Router();
const db = require('../config/db');  // Assuming db.js is where your MySQL connection is set up

router.get("/fetch-order/:username", async (req, res) => {
  const { username } = req.params;

  if (!username.match(/^[a-zA-Z0-9_]+$/)) {
    return res.status(400).json({ success: false, message: "Invalid username" });
  }


  const profileTable = `profile_${username}`;

  try {
    const connection = await db.getConnection(); // ✅ Get connection for transaction

    await new Promise((resolve, reject) => connection.beginTransaction((err) => (err ? reject(err) : resolve())));

    // ✅ Step 1: Get a random order that is **not in the user’s profile table**
    const orders = await db.queryAsync(`
      SELECT o.* FROM orders o 
      LEFT JOIN ${profileTable} p ON o.order_id = p.order_id 
      WHERE p.order_id IS NULL 
      ORDER BY RAND() 
      LIMIT 1
    `);

    if (orders.length === 0) {
      connection.release(); // ✅ Release connection
      return res.status(200).json({ success: false, message: "No new orders found" });
    }

    const randomOrder = orders[0];

    // ✅ Step 2: Process the order based on `remaining` count
    if (randomOrder.remaining <= 1) {
      await db.queryAsync(
        `INSERT INTO complete_orders (order_id, video_link, quantity, timestamp) VALUES (?, ?, ?, NOW())`,
        [randomOrder.order_id, randomOrder.video_link, randomOrder.quantity]
      );
      await db.queryAsync(`DELETE FROM orders WHERE order_id = ?`, [randomOrder.order_id]);
    } else {
      await db.queryAsync(
        `INSERT INTO temp_orders (order_id, video_link, quantity, remaining, timestamp) VALUES (?, ?, ?, ?, NOW())`,
        [randomOrder.order_id, randomOrder.video_link, randomOrder.quantity, randomOrder.remaining - 1]
      );
      await db.queryAsync(`DELETE FROM orders WHERE order_id = ?`, [randomOrder.order_id]);
    }

    // ✅ Step 3: Insert into user’s profile table
    await db.queryAsync(`INSERT INTO ${profileTable} (order_id, timestamp) VALUES (?, NOW())`, [randomOrder.order_id]);

    await new Promise((resolve, reject) => connection.commit((err) => (err ? reject(err) : resolve()))); // ✅ Commit transaction
    connection.release(); // ✅ Release connection

    res.status(200).json({ success: true, order: randomOrder });
  } catch (error) {
    console.error("❌ Error processing order:", error);

    if (error.connection) {
      await new Promise((resolve) => error.connection.rollback(() => resolve())); // ✅ Rollback transaction if error
      error.connection.release(); // ✅ Release connection
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
    connection = await db.getConnection();
    console.log("✅ Database connection established");

    await connection.beginTransaction();
    console.log("🔄 Transaction started");

    // Step 1: Check if the order exists in `orders`
    const [orderFromOrders] = await connection.query(
      `SELECT order_id, video_link, quantity FROM orders WHERE order_id = ? OR video_link = ? LIMIT 1`,
      [order_id, video_link]
    );

    // Step 2: Check if the order exists in `temp_orders`
    const [orderFromTemp] = await connection.query(
      `SELECT order_id, video_link, quantity FROM temp_orders WHERE order_id = ? OR video_link = ? LIMIT 1`,
      [order_id, video_link]
    );

    let orderDetails = null;
    let tableToDelete = null;

    if (orderFromOrders.length > 0 && orderFromTemp.length > 0) {
      console.log("⚠️ Order found in both tables! This should not happen.");
      await connection.rollback();
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
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    console.log(`✅ Order found in ${tableToDelete}, proceeding with deletion`);

    // Step 3: Delete from the correct table
    await connection.query(
      `DELETE FROM ${tableToDelete} WHERE order_id = ? OR video_link = ?`,
      [order_id, video_link]
    );

    console.log(`✅ Order deleted from ${tableToDelete}`);

    // Step 4: Move to `invalid_videos` table
    await connection.query(
      'INSERT INTO invalid_videos (order_id, video_link, quantity, error_type, timestamp) VALUES (?, ?, ?, ?, NOW())',
      [orderDetails.order_id, orderDetails.video_link, orderDetails.quantity, "unavailable"]
    );

    console.log("✅ Order moved to invalid_videos table");

    await connection.commit();
    console.log("✅ Transaction committed successfully");

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
      await connection.rollback();
      connection.release();
    }

    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
});



// Process data from frontend
router.post('/process', async (req, res) => {
  const { data } = req.body;

  try {
    const chunkSize = 3;
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }

    let successCount = 0;
    let errorCount = 0;

    for (const chunk of chunks) {
      const [orderId, videoLink, quantity] = chunk;

      const originalQuantity = parseInt(quantity);
      const additional = Math.ceil(originalQuantity * 0.15);
      const remaining = originalQuantity + additional;

      // Check if orderId or videoLink exists
      const checkQuery = 'SELECT * FROM orders WHERE order_id = ? OR video_link = ?';
      const existingOrders = await db.queryAsync(checkQuery, [orderId, videoLink]);

      if (existingOrders.length > 0) {
        // If exists, insert into error table
        const errorQuery =
          'INSERT INTO error_orders (order_id, video_link, quantity, remaining, timestamp) VALUES (?, ?, ?, ?, NOW())';
        await db.queryAsync(errorQuery, [orderId, videoLink, originalQuantity, remaining]);
        errorCount++;
      } else {
        // If not exists, insert into orders table
        const orderQuery =
          'INSERT INTO orders (order_id, video_link, quantity, remaining) VALUES (?, ?, ?, ?)';
        await db.queryAsync(orderQuery, [orderId, videoLink, originalQuantity, remaining]);
        successCount++;
      }
    }

    res.json({ success: true, inserted: successCount, errors: errorCount });
  } catch (err) {
    console.error("Error processing orders:", err);
    res.status(500).json({ message: 'Server error' });
  }
});



// Get orders from both 'orders' and 'temp_orders' tables
router.get('/ordersData', async (req, res) => {
  try {
    // Query to get orders from the 'orders' table
    const ordersQuery = 'SELECT order_id, video_link, quantity, remaining, "orders" AS tableName FROM orders';
    const tempOrdersQuery = 'SELECT order_id, video_link, quantity, remaining, "temp_orders" AS tableName FROM temp_orders';

    // Execute both queries
    db.queryAsync(ordersQuery + ' UNION ' + tempOrdersQuery, (err, result) => {
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

  try {
    // Check both tables for the order
    const [orderResult] = await db.queryAsync(
      'SELECT "orders" AS tableName FROM orders WHERE order_id = ? UNION SELECT "temp_orders" AS tableName FROM temp_orders WHERE order_id = ?',
      [orderId, orderId]
    );

    // Ensure orderResult is valid and not empty
    if (!orderResult || orderResult.length === 0) {
      return res.status(404).json({ message: 'Order not found in either table' });
    }

    const tableToDelete = orderResult.tableName; // Use orderResult[0] directly
    if (!tableToDelete) {
      return res.status(500).json({ message: 'Table name could not be determined' });
    }

    // Delete from the found table
    await db.queryAsync(`DELETE FROM ${tableToDelete} WHERE order_id = ?`, [orderId]);

    res.json({ success: true, message: `Order deleted from ${tableToDelete}` });
  } catch (err) {
    console.error("Error deleting order:", err);
    res.status(500).json({ message: 'Failed to delete order' });
  }
});


// Get orders from 'complete_orders' table
router.get('/ordersComplete', async (req, res) => {
  try {
    const query = 'SELECT * FROM complete_orders ORDER BY timestamp DESC';
    db.queryAsync(query, (err, result) => {
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
let isProcessing = false; // Flag to prevent overlapping executions

setInterval(async () => {
  if (isProcessing) return; // Prevent concurrent execution
  isProcessing = true;

  try {
    console.log("⏳ Checking temp_orders for processing...");

    // Start transaction
    await db.queryAsync('START TRANSACTION');

    // Get orders that have been in temp_orders for at least 60 seconds
    const tempOrders = await db.queryAsync(`
      SELECT * FROM temp_orders 
      WHERE TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= 60
      FOR UPDATE
    `);

    if (tempOrders.length === 0) {
      console.log("✅ No temp orders to process.");
      isProcessing = false;
      return;
    }

    for (const tempOrder of tempOrders) {
      const { order_id, video_link, quantity, remaining } = tempOrder;

      if (remaining > 0) {
        // Move back to orders table with updated remaining count
        await db.queryAsync(`
          INSERT INTO orders (order_id, video_link, quantity, remaining) 
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE remaining = VALUES(remaining)`, 
          [order_id, video_link, quantity, remaining]
        );

        console.log(`🔄 Order ${order_id} moved back to orders table.`);
      } else {
        // Move to complete_orders table if remaining is 0
        await db.queryAsync(`
          INSERT INTO complete_orders (order_id, video_link, quantity, timestamp) 
          VALUES (?, ?, ?, NOW())`, 
          [order_id, video_link, quantity]
        );

        console.log(`✅ Order ${order_id} moved to complete_orders.`);
      }

      // Delete processed order from temp_orders
      await db.queryAsync('DELETE FROM temp_orders WHERE order_id = ?', [order_id]);
      console.log(`🗑️ Order ${order_id} removed from temp_orders.`);
    }

    // Commit transaction
    await db.queryAsync('COMMIT');
  } catch (error) {
    console.error("❌ Error processing temp_orders:", error);
    await db.queryAsync('ROLLBACK'); // Rollback on failure
  } finally {
    isProcessing = false; // Reset flag
  }
}, 60000); // Run every minute


//funtion use every 1houre


const deleteOldOrders = async () => {
  try {
    console.log("🕒 Fetching all usernames...");

    // Step 1: Fetch all usernames from the user table
    const [users] = await db.queryAsync("SELECT username FROM user");

    if (!Array.isArray(users) || users.length === 0) {
      console.log("🚫 No users found. Skipping cleanup.");
      return;
    }

    // Step 2: Loop through each user
    for (const user of users) {
      const { username } = user;
      const profileTable = `profile_${username}`; // Dynamic table name

      // Check if the profile table exists
      const checkTableQuery = `SHOW TABLES LIKE ?`;
      const [tableExists] = await db.queryAsync(checkTableQuery, [profileTable]);

      if (tableExists.length === 0) {
        console.log(`⚠️ Table ${profileTable} does not exist. Skipping.`);
        continue;
      }

      // Step 3: Delete orders older than 24 hours in batches
      let deletedRows;
      do {
        const deleteQuery = `DELETE FROM ?? WHERE timestamp < NOW() - INTERVAL 24 HOUR LIMIT 1000`;
        const [result] = await db.queryAsync(deleteQuery, [profileTable]);
        deletedRows = result.affectedRows;

        console.log(`✅ Deleted ${deletedRows} old orders from ${profileTable}`);
      } while (deletedRows > 0); // Repeat until all old records are deleted
    }

    console.log("✅ Hourly cleanup job completed!");
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






