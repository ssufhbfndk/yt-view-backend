// Process data from frontend
const axios = require('axios');
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;



// Helper: YouTube ID extractor
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

      // Handle /shorts/VIDEO_ID
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

    // Check privacy public hai
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


module.exports = { getYouTubeVideoId, isValidYouTubeVideo };