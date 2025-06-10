const processPendingOrders = require('../services/orderProcessor');
const processTempOrders = require('../services/processTempOrders');
const deleteOldOrders = require('../services/cleanupOldOrders');
const cleanupOldIpTracking = require('../services/cleanupIpTracking');
const {setDelayTrueToFalse,setDelayFalseToTrue} = require('../services/updateDelayedOrders');

// Every 3 sec
setInterval(processPendingOrders, 3 * 1000);

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
  setDelayTrueToFalse()
    .catch(err => console.error("Error in checkAndUpdateDelayedOrders:", err));
}, 2 * 60 * 1000); // 2 minutes

setInterval(() => {
  setDelayFalseToTrue()
    .catch(err => console.error("Error in checkAndUpdateDelayedOrders:", err));
}, 3 * 60 * 1000); // 3 minutes


console.log('✅ Background jobs initialized:');
