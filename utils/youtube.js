const axios = require('axios');
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Helper: YouTube ID extractor from URL
const getYouTubeVideoId = (url) => {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace('www.', '').replace('m.', '');

    // Handle youtu.be short links
    if (hostname === 'youtu.be') {
      return parsedUrl.pathname.slice(1);
    }

    // Acceptable YouTube hostnames
    const validHostnames = [
      'youtube.com',
      'youtube-nocookie.com'
    ];

    if (validHostnames.includes(hostname)) {
      const path = parsedUrl.pathname;

      // Handle watch?v=VIDEO_ID
      if (path === '/watch') {
        return parsedUrl.searchParams.get('v');
      }

      // Handle /shorts/VIDEO_ID, /embed/VIDEO_ID, /live/VIDEO_ID, /v/VIDEO_ID
      if (path.startsWith('/shorts/') || path.startsWith('/embed/') || path.startsWith('/live/') || path.startsWith('/v/')) {
        return path.split('/')[2] || path.split('/')[1];
      }
    }

    return null;
  } catch (e) {
    console.error('❌ Error parsing YouTube URL:', e.message);
    return null;
  }
};

// Helper: Validate with YouTube API
const isValidYouTubeVideo = async (videoId) => {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=status,player,snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;
  try {
    const response = await axios.get(url);
    const item = response.data.items[0];
    if (!item) {
      return { valid: false, reason: 'Video not found' };
    }

    const { status, player, snippet } = item;

    // Check embeddable
    if (!status.embeddable) {
      return { valid: false, reason: 'Video not embeddable' };
    }

    // Check privacy public
    if (status.privacyStatus !== 'public') {
      return { valid: false, reason: `Video privacy: ${status.privacyStatus}` };
    }

    // Check player HTML se "Video unavailable" na ho
    if (player.embedHtml.includes('Video unavailable')) {
      return { valid: false, reason: 'Embed shows video unavailable' };
    }

    // Check agar video currently live hai
    if (snippet.liveBroadcastContent === 'live') {
      return { valid: false, reason: 'Currently Live Video not allowed' };
    }

    // Sab pass ho gaya
    return { valid: true };
  } catch (err) {
    console.error('YouTube API error:', err.response?.data || err.message);
    return { valid: false, reason: err.response?.data?.error?.message || err.message };
  }
};

// New function: Get video type and duration with multiplier based on URL and API data
const getVideoTypeAndDuration = async (videoId, url) => {
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;

  try {
    const response = await axios.get(apiUrl);
    const item = response.data.items[0];
    if (!item) {
      return { error: 'Video not found' };
    }

    const { snippet, contentDetails } = item;
    const liveBroadcastContent = snippet.liveBroadcastContent; // "none", "live", "upcoming"
    const durationISO = contentDetails.duration; // ISO 8601 duration format

    // Helper: Convert ISO 8601 duration to seconds
    const isoDurationToSeconds = (isoDuration) => {
      const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;
      const hours = parseInt(match[1] || 0, 10);
      const minutes = parseInt(match[2] || 0, 10);
      const seconds = parseInt(match[3] || 0, 10);
      return hours * 3600 + minutes * 60 + seconds;
    };

    const durationSeconds = isoDurationToSeconds(durationISO);

    // Determine video type based on URL and liveBroadcastContent
    let type = 'long';

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname.startsWith('/shorts/')) {
        type = 'short';
      } else if (liveBroadcastContent === 'live') {
        type = 'live';
      }
    } catch {
      // Fallback if URL parse fails, fallback to live or long only
      if (liveBroadcastContent === 'live') {
        type = 'live';
      }
    }

    // Duration logic
    let multiplier = 1;
    let finalDuration = durationSeconds;

    if (type === 'live' || type === 'long') {
      finalDuration = 60; // fixed duration
      multiplier = 1;
    } else if (type === 'short') {
      if (durationSeconds < 25) {
        multiplier = 3;
        finalDuration = durationSeconds * multiplier;
      } else if (durationSeconds >= 25) {
        multiplier = 2;
        if (durationSeconds >= 40) {
          // Random between 65 and 70
          finalDuration = Math.floor(Math.random() * (70 - 65 + 1)) + 65;
        } else {
          finalDuration = durationSeconds * multiplier;
        }
      }
    }

    return {
      type,
      originalDuration: durationSeconds,
      multiplier,
      finalDuration,
    };
  } catch (err) {
    console.error('YouTube API error:', err.response?.data || err.message);
    return { error: err.response?.data?.error?.message || err.message };
  }
};

module.exports = { getYouTubeVideoId, isValidYouTubeVideo, getVideoTypeAndDuration };
