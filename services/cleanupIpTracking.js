const db = require('../config/db'); // Adjust based on your project

const cleanupOldIpTracking = async () => {
  try {
    console.log("🧹 Checking order_ip_tracking for stale entries...");

    const result = await db.queryAsync(`
      DELETE FROM order_ip_tracking
      WHERE TIMESTAMPDIFF(MINUTE, timestamp, NOW()) >= 60
    `);

    console.log(`✅ Deleted ${result.affectedRows} old IP tracking records.`);
  } catch (error) {
    console.error("❌ Error cleaning up order_ip_tracking:", error);
  }
};

module.exports = cleanupOldIpTracking;
