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

// 🟡 3. Schedule IP cleanup at 12am, 6am, 12pm, 6pm (same as your original code)
const scheduleIpCleanup = () => {
  const now = new Date();
  const hours = [12]; // allowed hours
  let nextRun = null;

  for (let h of hours) {
    const runTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      h, 0, 0
    );

    if (runTime.getTime() > now.getTime()) {
      nextRun = runTime;
      break;
    }
  }

  // Agar aaj ke sare times nikal gaye → kal ka 12am set karo
  if (!nextRun) {
    nextRun = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0, 0, 0
    );
  }

  const delay = nextRun.getTime() - now.getTime();

  setTimeout(async () => {
    await cleanupOldIpTracking(); // 👈 IP cleanup sirf yahan chalega

    // Schedule next run again
    scheduleIpCleanup();
  }, delay);

  console.log(`⏳ Next IP cleanup scheduled at: ${nextRun}`);
};

scheduleIpCleanup();

console.log('✅ Background jobs initialized:');
