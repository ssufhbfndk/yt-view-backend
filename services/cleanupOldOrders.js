const db = require('../config/db'); // Adjust path based on your structure

const deleteOldOrders = async () => {
  try {
    console.log("🕒 Fetching all usernames...");

    const users = await db.queryAsync("SELECT username FROM user");

    if (!Array.isArray(users) || users.length === 0) {
      console.log("🚫 No users found. Skipping cleanup.");
      return;
    }

    console.log("🧹 Deleting old orders based on type...");

    for (const user of users) {
      const { username } = user;
      const profileTable = `profile_${username}`;

      // Check if table exists
      const checkTableQuery = `SHOW TABLES LIKE ?`;
      const tableExists = await db.queryAsync(checkTableQuery, [profileTable]);

      if (tableExists.length === 0) continue;

      // Delete logic based on 'type'
      const deleteQuery = `
        DELETE FROM ?? 
        WHERE 
          (type = 'short' AND timestamp < (NOW() - INTERVAL 8 HOUR))
          OR 
          (type = 'long' AND timestamp < (NOW() - INTERVAL 24 HOUR))
      `;

      const result = await db.queryAsync(deleteQuery, [profileTable]);
      console.log(`✅ Deleted ${result.affectedRows} expired rows from ${profileTable}`);
    }

    console.log("✅ Cleanup job completed successfully!");
  } catch (error) {
    console.error("❌ Error deleting old orders:", error);
  }
};

module.exports = deleteOldOrders;
