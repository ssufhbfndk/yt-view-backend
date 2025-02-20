const express = require('express');
const router = express.Router();
const db = require('../config/db');  // Assuming db.js is where your MySQL connection is set up

// Fetch orders and compare with user's profile table
router.get('/fetch-order/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const profileTable = "profile_" + username; // Assuming username-based profile tables

    // Step 1: Get orders that are not yet in the profile table
    const orders = await db.queryAsync(`
      SELECT * FROM orders 
      WHERE order_id NOT IN (SELECT order_id FROM ${profileTable})
    `);

    if (orders.length === 0) {
      return res.status(200).json({ success: false, message: "No new orders found" });
    }

    // Step 2: Pick a random order
    const randomOrder = orders[Math.floor(Math.random() * orders.length)];

    // Step 3: Check remaining quantity
    if (randomOrder.remaining <= 1) {
      // Move to complete_orders if remaining is 0
      await db.queryAsync(`
        INSERT INTO complete_orders (order_id, video_link, quantity, timestamp) 
        VALUES (?, ?, ?, NOW())`, 
        [randomOrder.order_id, randomOrder.video_link, randomOrder.quantity]
      );

      // Delete from orders since it's completed
      await db.queryAsync(`DELETE FROM orders WHERE order_id = ?`, [randomOrder.order_id]);

    } else {
      // Delete from orders 
     
      await db.queryAsync(`DELETE FROM orders WHERE order_id = ?`, [randomOrder.order_id]);

//insert into temp_orders
      await db.queryAsync(`
        INSERT INTO temp_orders (order_id, video_link, quantity, remaining, timestamp) 
        VALUES (?, ?, ?, ?, NOW())`, 
        [randomOrder.order_id, randomOrder.video_link, randomOrder.quantity, randomOrder.remaining - 1]
      );

      
    }

    // Step 4: Insert order into the user's profile table
    await db.queryAsync(`
      INSERT INTO ${profileTable} (order_id, timestamp) 
      VALUES (?, NOW())`, 
      [randomOrder.order_id]
    );


    // Step 6: Respond with the selected order details
    res.status(200).json({
      success: true,
      order: randomOrder,
    });

  } catch (error) {
    console.error("❌ Error processing order:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
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
  const { table } = req.query; // Using query params instead of body

  if (!table || (table !== 'orders' && table !== 'temp_orders')) {
    return res.status(400).json({ message: 'Invalid table specified' });
  }

  try {
    const deleteQuery = `DELETE FROM ${table} WHERE order_id = ?`;
    const result = await db.queryAsync(deleteQuery, [orderId]);

    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'Order deleted successfully' });
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (err) {
    console.error("Error deleting order:", err);
    res.status(500).json({ message: 'Server error' });
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






