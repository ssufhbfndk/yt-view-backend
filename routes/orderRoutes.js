const express = require('express');
const router = express.Router();
const db = require('../config/db');  // Assuming db.js is where your MySQL connection is set up

router.get("/fetch-order/:username", async (req, res) => {
  const { username } = req.params;

  // Validate username format
  if (!username.match(/^[a-zA-Z0-9_]+$/)) {
    return res.status(400).json({ success: false, message: "Invalid username" });
  }

  const profileTable = `profile_${username}`;

  try {
    // Get connection and start transaction
    const connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await connection.beginTransaction();

    try {
      // Step 1: Get a random order not in user's profile
      const [orders] = await connection.query(`
        SELECT o.* FROM orders o 
        LEFT JOIN ${profileTable} p ON o.order_id = p.order_id 
        WHERE p.order_id IS NULL 
        ORDER BY RAND() 
        LIMIT 1
      `);

      if (orders.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(200).json({ success: false, message: "No new orders found" });
      }

      const randomOrder = orders[0];

      // Step 2: Process order based on remaining count
      if (randomOrder.remaining <= 1) {
        await connection.query(
          `INSERT INTO complete_orders (order_id, video_link, quantity) VALUES (?, ?, ?)`,
          [randomOrder.order_id, randomOrder.video_link, randomOrder.quantity]
        );
      } else {
        await connection.query(
          `INSERT INTO temp_orders (order_id, video_link, quantity, remaining) VALUES (?, ?, ?, ?)`,
          [randomOrder.order_id, randomOrder.video_link, randomOrder.quantity, randomOrder.remaining - 1]
        );
      }

      // Remove from orders table
      await connection.query(`DELETE FROM orders WHERE order_id = ?`, [randomOrder.order_id]);

      // Step 3: Record in user's profile
      await connection.query(
        `INSERT INTO ${profileTable} (order_id) VALUES (?)`,
        [randomOrder.order_id]
      );

      await connection.commit();
      connection.release();

      return res.status(200).json({ 
        success: true, 
        order: {
          ...randomOrder,
          videoId: extractVideoId(randomOrder.video_link) // Extract clean video ID
        } 
      });

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }

  } catch (error) {
    console.error("❌ Error processing order:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal Server Error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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



// Temp orders processor
let isProcessing = false;

async function processTempOrders() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    console.log("⏳ Checking temp_orders for processing...");

    await db.executeTransaction(async (connection) => {
      const [tempOrders] = await connection.query(`
        SELECT * FROM temp_orders 
        WHERE TIMESTAMPDIFF(SECOND, timestamp, NOW()) >= 60
        FOR UPDATE
      `);

      if (tempOrders.length === 0) {
        console.log("✅ No temp orders to process.");
        return;
      }

      for (const tempOrder of tempOrders) {
        const { order_id, video_link, quantity, remaining } = tempOrder;

        try {
          if (remaining > 0) {
            await connection.query(`
              INSERT INTO orders (order_id, video_link, quantity, remaining) 
              VALUES (?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE 
                video_link = VALUES(video_link),
                quantity = VALUES(quantity),
                remaining = VALUES(remaining)
            `, [order_id, video_link, quantity, remaining]);
            console.log(`🔄 Order ${order_id} updated in orders table.`);
          } else {
            await connection.query(`
              INSERT INTO complete_orders (order_id, video_link, quantity) 
              VALUES (?, ?, ?)
            `, [order_id, video_link, quantity]);
            console.log(`✅ Order ${order_id} moved to complete_orders.`);
          }

          await connection.query('DELETE FROM temp_orders WHERE order_id = ?', [order_id]);
          console.log(`🗑️ Order ${order_id} removed from temp_orders.`);

        } catch (error) {
          console.error(`❌ Error processing order ${order_id}:`, error);
          // Continue with next order
        }
      }
    });
  } catch (error) {
    console.error("❌ Transaction Error:", error);
  } finally {
    isProcessing = false;
  }
}

// Run every minute
setInterval(processTempOrders, 60000);


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






