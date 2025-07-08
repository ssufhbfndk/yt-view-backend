const db = require('../config/db');

const cleanupOldIpTracking = async () => {
  try {
    // Get today's 1:00 PM
    const now = new Date();
    const onePM = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      13, 0, 0 // 1:00 PM today
    );

    // Convert to MySQL DATETIME format (YYYY-MM-DD HH:mm:ss)
    const formattedOnePM = onePM.toISOString().slice(0, 19).replace('T', ' ');

    // Delete records where timestamp is older than today's 1 PM
    const result = await db.queryAsync(`
      DELETE FROM order_ip_tracking
      WHERE timestamp < ?
    `, [formattedOnePM]);

    console.log(`✅ Deleted ${result.affectedRows} old IP tracking records (before 1 PM).`);
  } catch (error) {
    console.error("❌ Error cleaning up order_ip_tracking:", error);
  }
};


module.exports = cleanupOldIpTracking;
