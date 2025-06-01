require('dotenv').config();
const axios = require('axios');
const db = require('../config/db');

const fetchNewOrders = async () => {
  try {
    const response = await axios.post('https://watchtimehub.com/api/v2', {
      key: process.env.API_KEY,
      action: 'orders',
      service: process.env.SERVICE_ID
    });

    if (!response || !response.data || !Array.isArray(response.data)) {
      console.log('⚠️ No valid orders received.');
      return;
    }

    const orders = response.data;

    console.log(`📦 Fetched ${orders.length} orders from WatchTimeHub`);

    for (const order of orders) {
      const { order: order_id, link: video_link, quantity, remains } = order;

      const exists = await db.queryAsync(
        'SELECT order_id FROM pending_orders WHERE order_id = ?',
        [order_id]
      );

      if (exists.length > 0) {
        console.log(`⚠️ Order already exists: ${order_id}`);
        continue;
      }

      await db.queryAsync(
        `INSERT INTO pending_orders (order_id, video_link, quantity, remaining, timestamp)
         VALUES (?, ?, ?, ?, NOW())`,
        [order_id, video_link, quantity, remains]
      );

      console.log(`✅ New pending order inserted: ${order_id}`);
    }
  } catch (error) {
    console.error('❌ Failed to fetch orders:', error.message);
  }
};

module.exports = fetchNewOrders;
