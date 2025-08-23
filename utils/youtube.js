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
  const url = `https://www.googleapis.com/youtube/v3/videos?part=status,snippet,contentDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`;

  try {
    const response = await axios.get(url);
    const item = response.data.items[0];

    if (!item) {
      return { valid: false, reason: 'Video not found' };
    }

    const { status, snippet, contentDetails } = item;

    // ❌ Privacy check
    if (status.privacyStatus !== 'public') {
      return { valid: false, reason: `Video privacy: ${status.privacyStatus}` };
    }

    // ❌ Live check
    if (snippet.liveBroadcastContent === 'live') {
      return { valid: false, reason: 'Currently Live Video not allowed' };
    }

    // ❌ Age restriction check
    if (
      contentDetails?.contentRating?.ytRating === 'ytAgeRestricted'
    ) {
      return { valid: false, reason: 'Video is age-restricted, not allowed' };
    }

    // ✅ All passed
    return { valid: true };
  } catch (err) {
    console.error('YouTube API error:', err.response?.data || err.message);
    return { valid: false, reason: err.response?.data?.error?.message || err.message };
  }
};


// New function: Get video type and duration with multiplier based on URL and API data
const getVideoTypeAndDuration = async (videoId, url, passedDuration) => {
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;

  try {
    const response = await axios.get(apiUrl);
    const item = response.data.items[0];
    if (!item) {
      return { error: 'Video not found' };
    }

    const { snippet, contentDetails } = item;
    const liveBroadcastContent = snippet.liveBroadcastContent;
    const durationISO = contentDetails.duration;

    // Convert ISO 8601 duration to seconds
    const isoDurationToSeconds = (isoDuration) => {
      const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;
      const hours = parseInt(match[1] || 0, 10);
      const minutes = parseInt(match[2] || 0, 10);
      const seconds = parseInt(match[3] || 0, 10);
      return hours * 3600 + minutes * 60 + seconds;
    };

    const durationSeconds = isoDurationToSeconds(durationISO);

    // Determine video type
    let type = 'long';
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname.startsWith('/shorts/')) {
        type = 'short';
      } else if (liveBroadcastContent === 'live') {
        type = 'live';
      }
    } catch {
      if (liveBroadcastContent === 'live') {
        type = 'live';
      }
    }

    // Duration and multiplier logic
    let multiplier = 1;
    let finalDuration = durationSeconds;

    if (type === 'short') {
      // ✅ Your simplified short logic
      if (durationSeconds <= 61) {
        multiplier = 3;
        finalDuration = (durationSeconds * multiplier) + 6;
    
      } else if (durationSeconds > 61) {
        multiplier = 1;
        finalDuration = 10;
      }
    } else {
      // ✅ For long/live videos — keep old logic
      const pendingValue = parseInt(passedDuration || 0, 10);
      if (pendingValue > 0) {
        if (durationSeconds > pendingValue) {
          finalDuration = pendingValue;
        } else {
          finalDuration = durationSeconds;
        }
      } else {
        finalDuration = durationSeconds;
      }
      multiplier = 1;
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
