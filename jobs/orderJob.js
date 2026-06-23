const processPendingOrders = require('../services/orderProcessor');
const processTempOrders = require('../services/processTempOrders');
const deleteOldOrders = require('../services/cleanupOldOrders');
const cleanupOldIpTracking = require('../services/cleanupIpTracking');
const cleanOldModelDevices = require('../services/cleanupModelDevice'); // ✅ NEW

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
}, 30 * 60 * 1000);

// 🟡 Run IP cleanup every 30 minutes
const scheduleIpCleanup = () => {
  setInterval(async () => {
    try {
      await cleanupOldIpTracking();
      console.log("✅ IP cleanup executed at", new Date().toLocaleString());
    } catch (error) {
      console.error("❌ Error running IP cleanup:", error);
    }
  }, 30 * 60 * 1000);
};

// Start IP cleanup
scheduleIpCleanup();


// =====================================================
// 🔥 NEW: MODEL DEVICES CLEANUP (Every 1 Hour)
// =====================================================

// 🟢 Run once on server start
(async () => {
  try {
    await cleanOldModelDevices();
    console.log("✅ ModelDevices cleanup executed at startup");
  } catch (err) {
    console.error("❌ Error during initial ModelDevices cleanup:", err);
  }
})();

// 🟡 Then run every 1 hour
setInterval(async () => {
  try {
    await cleanOldModelDevices();
    console.log("✅ ModelDevices cleanup executed (1 hour interval)");
  } catch (err) {
    console.error("❌ Error during ModelDevices cleanup:", err);
  }
}, 60 * 60 * 1000); // 1 hour


console.log('✅ Background jobs initialized:');