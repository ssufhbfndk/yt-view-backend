const processPendingOrders = require('../services/orderProcessor');
const processTempOrders = require('../services/processTempOrders');
const deleteOldOrders = require('../services/cleanupOldOrders');
const cleanupOldIpTracking = require('../services/cleanupIpTracking');

// Every 3 sec
setInterval(processPendingOrders, 3 * 1000);

// Every 30 sec
setInterval(processTempOrders, 30 * 1000);

// 🟢 Run old orders cleanup immediately on server start
(async () => {
  try {
    await deleteOldOrders();
    console.log("✅ Old orders cleanup executed at startup");
  } catch (err) {
    console.error("❌ Error during initial old orders cleanup:", err);
  }
})();

// 🟡 Then schedule old orders cleanup every 30 minutes
setInterval(async () => {
  try {
    await deleteOldOrders();
    console.log("✅ Old orders cleanup executed (30 min interval)");
  } catch (err) {
    console.error("❌ Error during scheduled old orders cleanup:", err);
  }
}, 30 * 60 * 1000); // 30 minutes

// 🟡 Run IP cleanup every 10 minutes
const scheduleIpCleanup = () => {
  setInterval(async () => {
    try {
      await cleanupOldIpTracking(); // 👈 Run cleanup function
      console.log("✅ IP cleanup executed at", new Date().toLocaleString());
    } catch (error) {
      console.error("❌ Error running IP cleanup:", error);
    }
  }, 10 * 60 * 1000); // 10 min = 600000 ms
};

// Start cleanup schedule
scheduleIpCleanup();


console.log('✅ Background jobs initialized:');
