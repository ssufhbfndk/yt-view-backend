const db = require('../config/db');

const cleanupOldIpTracking = async () => {
  try {
    // Abhi ka exact time
    const now = new Date();

    // ✅ Delete records based on type:
    //  - 'short' → older than 2 hours
    //  - others  → older than 24 hours
    const result = await db.queryAsync(`
      DELETE FROM order_ip_tracking
      WHERE 
        (type = 'short' AND timestamp < (NOW() - INTERVAL 3 HOUR))
        OR
        (type <> 'short' AND timestamp < (NOW() - INTERVAL 24 HOUR))
    `);

    console.log(
      `✅ Deleted ${result.affectedRows} IP tracking records (short >2h, others >24h) — till ${now.toISOString()}.`
    );
  } catch (error) {
    console.error("❌ Error cleaning up order_ip_tracking:", error);
  }
};

module.exports = cleanupOldIpTracking;
