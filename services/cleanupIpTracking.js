const db = require("../config/db");

const cleanupOldIpTracking = async () => {
  let deletedShort = 0;
  let deletedNormal = 0;

  try {
    // 🔥 SHORT TYPE CLEANUP (2 hours old)
    const shortResult = await db.queryAsync(`
      DELETE FROM order_ip_tracking
      WHERE type = 'short'
      AND timestamp < (NOW() - INTERVAL 2 HOUR)
    `);

    deletedShort = shortResult.affectedRows || 0;

    // 🔥 OTHER TYPES CLEANUP (24 hours old)
    const normalResult = await db.queryAsync(`
      DELETE FROM order_ip_tracking
      WHERE type <> 'short'
      AND timestamp < (NOW() - INTERVAL 24 HOUR)
    `);

    deletedNormal = normalResult.affectedRows || 0;

    // 📊 LOG SUMMARY
    console.log(
      `🧹 Cleanup completed:
      - SHORT (>2h): ${deletedShort}
      - OTHER (>24h): ${deletedNormal}
      - TOTAL: ${deletedShort + deletedNormal}
      - TIME: ${new Date().toISOString()}`
    );

  } catch (error) {
    console.error("❌ Error cleaning up order_ip_tracking:", error);
  }
};

module.exports = cleanupOldIpTracking;