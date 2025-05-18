const db = require('../config/db');
const delay = require('../utils/delay');
const { getYouTubeVideoId, isValidYouTubeVideo } = require('../utils/youtube');



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

module.exports = processPendingOrders;
