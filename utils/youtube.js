const axios = require('axios');
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// ===============================
// 🔹 Extract Video ID
// ===============================
const getYouTubeVideoId = (url) => {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace('www.', '').replace('m.', '');

    if (hostname === 'youtu.be') {
      return parsedUrl.pathname.slice(1);
    }

    const validHostnames = ['youtube.com', 'youtube-nocookie.com'];

    if (validHostnames.includes(hostname)) {
      const path = parsedUrl.pathname;

      if (path === '/watch') {
        return parsedUrl.searchParams.get('v');
      }

      if (
        path.startsWith('/shorts/') ||
        path.startsWith('/embed/') ||
        path.startsWith('/live/') ||
        path.startsWith('/v/')
      ) {
        return path.split('/')[2] || path.split('/')[1];
      }
    }

    return null;
  } catch (e) {
    console.error('❌ URL parse error:', e.message);
    return null;
  }
};

// ===============================
// 🔥 VALIDATE VIDEO (UPDATED)
// ===============================
const isValidYouTubeVideo = async (videoId) => {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=status,snippet,contentDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`;

  try {
    const response = await axios.get(url, { timeout: 5000 });

    if (!response.data?.items || response.data.items.length === 0) {
      return { valid: false, reason: "Video not found or unavailable" };
    }

    const item = response.data.items[0];
    const { status, snippet, contentDetails } = item;

    if (!status || status.uploadStatus !== 'processed') {
      return { valid: false, reason: "Video not processed" };
    }

    if (status.privacyStatus !== 'public' && status.privacyStatus !== 'unlisted') {
      return { valid: false, reason: `Privacy: ${status.privacyStatus}` };
    }

    if (snippet?.liveBroadcastContent === 'live') {
      return { valid: false, reason: "Live video not allowed" };
    }

    if (contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') {
      return { valid: false, reason: "Age restricted video" };
    }

    if (!snippet?.title || snippet.title.toLowerCase().includes("deleted")) {
      return { valid: false, reason: "Video deleted/unavailable" };
    }

    return { valid: true };

  } catch (err) {
    console.error("❌ YouTube API error:", err.response?.data || err.message);

    return {
      valid: false,
      reason: "YouTube API error"
    };
  }
};

// ===============================
// 🔹 GET CHANNEL NAME (UPDATED)
// ===============================
const getChannelName = async (videoId) => {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;

  try {
    const res = await axios.get(url, { timeout: 5000 });

    const item = res.data?.items?.[0];
    if (!item) {
      return null;
    }

    return item.snippet?.channelTitle || null;

  } catch (err) {
    console.error("❌ Channel API error:", err.response?.data || err.message);
    return null; // safe fallback
  }
};

// ===============================
// 🔥 VIDEO TYPE + DURATION (UPDATED)
// ===============================
const getVideoTypeAndDuration = async (videoId, url, passedDuration) => {
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;

  try {
    const response = await axios.get(apiUrl, { timeout: 5000 });

    const item = response.data?.items?.[0];
    if (!item) {
      return { error: "Video not found (API)" };
    }

    const { snippet, contentDetails } = item;

    const isoToSec = (iso) => {
      const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;
      return (parseInt(match[1] || 0) * 3600) +
             (parseInt(match[2] || 0) * 60) +
             (parseInt(match[3] || 0));
    };

    const durationSeconds = isoToSec(contentDetails.duration);

    let type = 'long';
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith('/shorts/')) {
        type = 'short';
      } else if (snippet.liveBroadcastContent === 'live') {
        type = 'live';
      }
    } catch {
      if (snippet.liveBroadcastContent === 'live') {
        type = 'live';
      }
    }

    let multiplier = 1;
    let finalDuration = durationSeconds;

    if (type === 'short') {
      if (durationSeconds <= 119) {
        multiplier = 3;
        finalDuration = (durationSeconds * 3) + 15;
      } else {
        finalDuration = Math.floor(Math.random() * 21) + 10;
      }
    } else {
      const pending = parseInt(passedDuration || 0, 10);
      if (pending > 0) {
        finalDuration = Math.min(durationSeconds, pending);
      }
    }

    return {
      type,
      originalDuration: durationSeconds,
      multiplier,
      finalDuration
    };

  } catch (err) {
    console.error("❌ Duration API error:", err.response?.data || err.message);

    return {
      error: "YouTube API error"
    };
  }
};

module.exports = {
  getYouTubeVideoId,
  isValidYouTubeVideo,
  getChannelName,
  getVideoTypeAndDuration
};