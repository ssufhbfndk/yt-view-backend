const { queryAsync } = require("../config/db");

// 🧹 Delete old model devices (default: 24 hours)
const cleanOldModelDevices = async () => {
  try {
    console.log("🧹 ModelDevices Cleanup Started:", new Date());

    const result = await queryAsync(`
    DELETE FROM model_devices
WHERE timestamp < NOW() - INTERVAL 24 HOUR;
    `);

    if (result === null) {
      console.log("⚠️ Cleanup skipped (DB busy or down)");
      return;
    }

    console.log(`✅ ModelDevices Deleted Rows: ${result.affectedRows || 0}`);

  } catch (error) {
    console.error("❌ ModelDevices Cleanup Error:", error);
  }
};

module.exports = cleanOldModelDevices;