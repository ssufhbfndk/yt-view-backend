const db = require('../config/db'); // Adjust path based on your structure

const deleteOldOrders = async () => {
  try {
    console.log("🕒 Fetching all usernames...");

    const users = await db.queryAsync("SELECT username FROM user");

    if (!Array.isArray(users) || users.length === 0) {
      console.log("🚫 No users found. Skipping cleanup.");
      return;
    }

    const fixedTime = new Date(Date.now() - 10 * 60 * 60 * 1000); // 8 hours ago

    for (const user of users) {
      const { username } = user;
      const profileTable = `profile_${username}`;

      const checkTableQuery = `SHOW TABLES LIKE ?`;
      const tableExists = await db.queryAsync(checkTableQuery, [profileTable]);

      if (tableExists.length === 0) {
        continue;
      }

     

      const deleteQuery = `DELETE FROM ?? WHERE timestamp < ?`;
      const result = await db.queryAsync(deleteQuery, [profileTable, fixedTime]);

      console.log(`✅ Deleted ${result.affectedRows} old orders from ${profileTable}`);
    }

    console.log("✅ Cleanup job completed!");
  } catch (error) {
    console.error("❌ Error deleting old orders:", error);
  }
};

module.exports = deleteOldOrders;
