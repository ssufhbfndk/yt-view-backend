const db = require("../config/db");

const deleteOldOrders = async () => {

  try {
    console.log("🕒 Starting cleanup job...");

    // =========================
    // GET USERS
    // =========================
  const users = await db.queryAsync(
  "SELECT username FROM user WHERE status = 1"
);

    if (!users || users.length === 0) {
      console.log("🚫 No users found. Skipping cleanup.");
      return;
    }

    console.log(`👥 Found ${users.length} users`);

    // =========================
    // LOOP USERS
    // =========================
    for (const user of users) {

      const username = user.username;
      const profileTable = `profile_${username}`;

      try {

        // =========================
        // DELETE ALL ORDERS OLDER THAN 24 HOURS
        // =========================
        const result = await db.queryAsync(
          `
          DELETE FROM \`${profileTable}\`
          WHERE timestamp < (NOW() - INTERVAL 24 HOUR)
          `
        );

        if (!result) continue;

        console.log(
          `🧹 ${profileTable}: ${result.affectedRows || 0} rows deleted`
        );

      } catch (err) {

        // Table exist na kare to skip
        if (err.code === "ER_NO_SUCH_TABLE") {
          continue;
        }

        console.error(`❌ Error on ${profileTable}:`, err.message);
      }
    }

    console.log("✅ Cleanup job completed successfully!");

  } catch (error) {
    console.error("❌ Critical cleanup error:", error.message);
  }
};

module.exports = deleteOldOrders;