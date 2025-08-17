const db = require('../config/db');

const cleanupOldIpTracking = async () => {
  try {
    // Delete records older than 2 hours from current time
    const result = await db.queryAsync(`
      DELETE FROM order_ip_tracking
      WHERE timestamp < (NOW() - INTERVAL 4 HOUR)
    `);

    console.log(`✅ Deleted ${result.affectedRows} IP tracking records older than 2 hours.`);
  } catch (error) {
    console.error("❌ Error cleaning up order_ip_tracking:", error);
  }
};

module.exports = cleanupOldIpTracking;
