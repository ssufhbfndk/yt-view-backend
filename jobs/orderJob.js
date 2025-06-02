const processPendingOrders = require('../services/orderProcessor');
const processTempOrders = require('../services/processTempOrders');
const deleteOldOrders = require('../services/cleanupOldOrders');
const cleanupOldIpTracking = require('../services/cleanupIpTracking');
const updateDelayFlagsAndTimestamps = require('../services/updateDelayedOrders');
const fetchNewOrders = require('../services/fetchNewOrders');

// Every 5 minutes
setInterval(processPendingOrders, 5 * 60 * 1000);

// Every 30 sec
setInterval(processTempOrders, 30 * 1000);

// Every 1 hour
setInterval(() => {
  console.log("🕒 Running hourly cleanup job...");
  deleteOldOrders();
}, 30 * 60 * 1000);

// Every 2 minutes
setInterval(() => {
  console.log("🧼 Running 2-minute IP log cleanup...");
  cleanupOldIpTracking();
}, 2 * 60 * 1000);

// Run checkAndUpdateDelayedOrders every 2 minutes (120000 ms)
setInterval(() => {
  updateDelayFlagsAndTimestamps()
    .catch(err => console.error("Error in checkAndUpdateDelayedOrders:", err));
}, 2 * 60 * 1000); // 2 minutes

// Schedule to run every 10 minutes
  setInterval(() => {
    console.log('⏰ Running scheduled fetchNewOrders job...');
    fetchNewOrders();
  }, 10 * 60 * 1000); // 10 minutes in milliseconds


console.log('✅ Background jobs initialized:');
