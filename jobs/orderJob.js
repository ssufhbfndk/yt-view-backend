const processPendingOrders = require('../services/orderProcessor');
const processTempOrders = require('../services/processTempOrders');
const deleteOldOrders = require('../services/cleanupOldOrders');
const cleanupOldIpTracking = require('../services/cleanupIpTracking');

// Every 3 sec
setInterval(processPendingOrders, 3 * 1000);

// Every 30 sec
setInterval(processTempOrders, 30 * 1000);

// 🟢 1. Run once at server start
(async () => {
  await deleteOldOrders();
  await cleanupOldIpTracking();
})();

// 🟡 2. Schedule daily run at exactly 1 PM
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
    const runBothCleanups = async () => {
      await deleteOldOrders();
      await cleanupOldIpTracking();
    };

    runBothCleanups();

    // After first run, repeat every 24 hours
    setInterval(runBothCleanups, 24 * 60 * 60 * 1000);
  }, delay);
};

scheduleDailyCleanup();


console.log('✅ Background jobs initialized:');
