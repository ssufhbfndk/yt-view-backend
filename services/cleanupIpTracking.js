const db = require('../config/db');

const cleanupOldIpTracking = async () => {
  try {
    

    // Delete records from order_ip_tracking table
    // jinka timestamp ab se 60 minutes ya usse zyada purana hai
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
