const db = require('../config/db');

const cleanupOldIpTracking = async () => {
  try {
    // Abhi ka exact time
    const now = new Date();

    // Delete sirf un records ko jo 24 ghante se purane hain
    const result = await db.queryAsync(`
      DELETE FROM order_ip_tracking
      WHERE timestamp < (NOW() - INTERVAL 24 HOUR)
    `);

    console.log(
      `✅ Deleted ${result.affectedRows} IP tracking records older than 24 hours (till ${now.toISOString()}).`
    );
  } catch (error) {
    console.error("❌ Error cleaning up order_ip_tracking:", error);
  }
};

module.exports = cleanupOldIpTracking;
