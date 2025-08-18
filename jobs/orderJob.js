const processPendingOrders = require('../services/orderProcessor');
const processTempOrders = require('../services/processTempOrders');
const deleteOldOrders = require('../services/cleanupOldOrders');
const cleanupOldIpTracking = require('../services/cleanupIpTracking');

// Every 3 sec
setInterval(processPendingOrders, 3 * 1000);

// Every 30 sec
setInterval(processTempOrders, 30 * 1000);

// 🟢 1. Run once at server start (only old orders)
(async () => {
  await deleteOldOrders();
})();

// 🟡 2. Schedule daily cleanup for deleteOldOrders (example: 1 PM daily)
const scheduleDailyCleanup = () => {
  const now = new Date();
  const onePM = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    13, 0, 0
  );

  let delay = onePM.getTime() - now.getTime();

  if (delay < 0) {
    delay += 24 * 60 * 60 * 1000;
  }

  setTimeout(() => {
    const runDailyCleanup = async () => {
      await deleteOldOrders();   // 👈 sirf deleteOldOrders chalega
    };

    runDailyCleanup();

    // After first run, repeat every 24 hours
    setInterval(runDailyCleanup, 24 * 60 * 60 * 1000);
  }, delay);
};

scheduleDailyCleanup();

// 🟡 3. Schedule IP cleanup at 12am, 6am, 12pm, 6pm
const scheduleIpCleanup = () => {
  const now = new Date();
  const hours = [0, 6, 12, 18]; // allowed hours
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
