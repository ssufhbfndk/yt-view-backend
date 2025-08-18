const db = require('../config/db');

const cleanupOldIpTracking = async () => {
  try {
    // Abhi ka exact time
    const now = new Date();

    // Delete sabhi records jo current time se purane hain
    const result = await db.queryAsync(`
      DELETE FROM order_ip_tracking
      WHERE timestamp < NOW()
    `);

    console.log(
      `✅ Deleted ${result.affectedRows} IP tracking records older than ${now.toISOString()}.`
    );
  } catch (error) {
    console.error("❌ Error cleaning up order_ip_tracking:", error);
  }
};

module.exports = cleanupOldIpTracking;
