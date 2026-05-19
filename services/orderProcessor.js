const db = require("../config/db");

const {
  getYouTubeVideoId,
  isValidYouTubeVideo,
  getVideoTypeAndDuration,
  getChannelName
} = require("../utils/youtube");

const clean = (v) => String(v || "").trim();

const processPendingOrders = async () => {

  try {

    console.log("🟡 Checking pending orders...");

    // =====================================
    // PICK + DELETE FROM PENDING
    // =====================================
    const order = await db.withTransaction(async (conn) => {

      const [rows] = await conn.query(`
        SELECT *
        FROM pending_orders
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE
      `);

      if (!rows.length) return null;

      const picked = rows[0];

      await conn.query(
        `DELETE FROM pending_orders WHERE id = ?`,
        [picked.id]
      );

      return picked;
    });

    // =====================================
    // NO ORDER
    // =====================================
    if (!order) {
      console.log("⚠️ No pending orders found.");
      return;
    }

    const order_id = clean(order.order_id);

    console.log(`➡️ Processing Order: ${order_id}`);

    const {
      video_link,
      quantity,
      remaining,
      duration
    } = order;

    // =====================================
    // VIDEO ID
    // =====================================
    const videoId = getYouTubeVideoId(video_link);

    // =====================================
    // INVALID LINK
    // =====================================
    if (!videoId) {

      await db.queryAsync(
        `
        INSERT INTO error_orders
        (
          order_id,
          video_link,
          quantity,
          duration,
          remaining,
          reason,
          timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          order_id,
          video_link,
          quantity,
          duration || 0,
          remaining,
          "Invalid YouTube link"
        ]
      );

      return;
    }

    // =====================================
    // DUPLICATE CHECK
    // =====================================
    const duplicateCheck = await db.queryAsync(
      `
      SELECT 'order_id' AS type
      FROM orders
      WHERE order_id = ?

      UNION ALL

      SELECT 'order_id'
      FROM temp_orders
      WHERE order_id = ?

      UNION ALL

      SELECT 'video_link'
      FROM orders
      WHERE video_link = ?

      UNION ALL

      SELECT 'video_link'
      FROM temp_orders
      WHERE video_link = ?

      LIMIT 1
      `,
      [
        order_id,
        order_id,
        video_link,
        video_link
      ]
    );

    // =====================================
    // DUPLICATE FOUND
    // =====================================
    if (duplicateCheck && duplicateCheck.length > 0) {

      const duplicateType = duplicateCheck[0].type;

      const reason =
        duplicateType === "order_id"
          ? "Duplicate order_id"
          : "Duplicate video_link";

      await db.queryAsync(
        `
        INSERT INTO error_orders
        (
          order_id,
          video_link,
          quantity,
          duration,
          remaining,
          reason,
          timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          order_id,
          video_link,
          quantity,
          duration || 0,
          remaining,
          reason
        ]
      );

      return;
    }

    // =====================================
    // YOUTUBE VALIDATION
    // =====================================
    const yt = await isValidYouTubeVideo(videoId);

    // =====================================
    // YOUTUBE API ERROR
    // =====================================
    if (!yt?.valid && yt?.reason === "YouTube API error") {

      console.log("❌ YouTube API Error");

      await db.queryAsync(
        `
        INSERT INTO error_orders
        (
          order_id,
          video_link,
          quantity,
          duration,
          remaining,
          reason,
          timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          order_id,
          video_link,
          quantity,
          duration || 0,
          remaining,
          "YouTube API Error"
        ]
      );

      return;
    }

    // =====================================
    // INVALID VIDEO
    // =====================================
    if (!yt?.valid) {

      await db.queryAsync(
        `
        INSERT INTO invalid_orders
        (
          order_id,
          video_link,
          quantity,
          duration,
          remaining,
          error_reason,
          timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          order_id,
          video_link,
          quantity,
          duration || 0,
          remaining,
          yt?.reason || "Invalid video"
        ]
      );

      return;
    }

    // =====================================
    // FETCH VIDEO INFO
    // =====================================
    const [channelName, videoInfo] = await Promise.all([
      getChannelName(videoId),

      getVideoTypeAndDuration(
        videoId,
        video_link,
        duration
      )
    ]);

    // =====================================
    // DURATION API ERROR
    // =====================================
    if (videoInfo?.error === "YouTube API error") {

      console.log("❌ Duration API Error");

      await db.queryAsync(
        `
        INSERT INTO error_orders
        (
          order_id,
          video_link,
          quantity,
          duration,
          remaining,
          reason,
          timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          order_id,
          video_link,
          quantity,
          duration || 0,
          remaining,
          "Duration API Error"
        ]
      );

      return;
    }

    // =====================================
    // FINAL DURATION
    // =====================================
    const finalDuration =
      videoInfo?.finalDuration || duration || 60;

    // =====================================
    // RANDOM WAIT
    // =====================================
    const delayPool = [45, 60, 75, 90, 120];

    const wait =
      delayPool[
        Math.floor(Math.random() * delayPool.length)
      ];

    // =====================================
    // INSERT FINAL ORDER
    // =====================================
    const insertResult = await db.queryAsync(
      `
      INSERT INTO orders
      (
        order_id,
        video_link,
        quantity,
        remaining,
        delay,
        duration,
        type,
        wait,
        channel_name,
        timestamp
      )
      VALUES
      (?, ?, ?, ?, 1, ?, ?, ?, ?, NOW())
      `,
      [
        order_id,
        video_link,
        quantity,
        remaining / (videoInfo?.multiplier || 1),
        finalDuration,
        videoInfo?.type || "video",
        wait,
        channelName || "Unknown"
      ]
    );

    // =====================================
    // INSERT FAILED
    // =====================================
    if (insertResult === null) {

      await db.queryAsync(
        `
        INSERT INTO error_orders
        (
          order_id,
          video_link,
          quantity,
          duration,
          remaining,
          reason,
          timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          order_id,
          video_link,
          quantity,
          finalDuration,
          remaining,
          "Order insert failed"
        ]
      );

      return;
    }

    // =====================================
    // SUCCESS
    // =====================================
    console.log(`✅ Order processed successfully: ${order_id}`);

  } catch (err) {

    console.error(
      "❌ Critical Processing Error:",
      err.message
    );
  }
};

module.exports = processPendingOrders;