const processPendingOrders = require('../services/orderProcessor');
const processTempOrders = require('../services/tempOrderProcessor');
const deleteOldOrders = require('../services/cleanupOldOrders');
const cleanupOldIpTracking = require('../services/cleanupIpTracking');

// Every 5 minutes
setInterval(processPendingOrders, 5 * 60 * 1000);

// Every 1 minute
setInterval(processTempOrders, 60 * 1000);

// Every 1 hour
setInterval(() => {
  console.log("🕒 Running hourly cleanup job...");
  deleteOldOrders();
}, 60 * 60 * 1000);

// Every 2 minutes
setInterval(() => {
  console.log("🧼 Running 2-minute IP log cleanup...");
  cleanupOldIpTracking();
}, 2 * 60 * 1000);

console.log('✅ Background jobs initialized:');
