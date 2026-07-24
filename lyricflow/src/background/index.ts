import type { SongInfo, LyricLine, UISettings } from '../types';

let spotifyPort: chrome.runtime.Port | null = null;
const overlayPorts: Set<chrome.runtime.Port> = new Set();
const lyricsCache = new Map<string, LyricLine[]>();

// Global UI State
let globalSettings: UISettings = {
  isTransparent: false,
  isLocked: false,
  position: { x: 20, y: 20 },
  size: { width: 380, height: 120 }
};

chrome.storage.local.get(['lyricflow_settings'], (result) => {
  if (result.lyricflow_settings) {
    globalSettings = { ...globalSettings, ...result.lyricflow_settings };
  }
});

//helper function to save settings to storage and broadcast to all overlay ports
function saveAndBroadcastSettings() {
  chrome.storage.local.set({ lyricflow_settings: globalSettings });
  broadcastSync();
}

// Store the last known song state to broadcast immediately when a new tab opens
let lastKnownSong: SongInfo | null = null;
let lastKnownLyrics: LyricLine[] | null = null;

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name === 'spotify') {
    spotifyPort = port;
    port.onMessage.addListener((msg: any) => {
      if (msg.type === 'SONG_CHANGED') {
        handleSpotifyUpdate(msg.payload);
      }
    });
    port.onDisconnect.addListener(() => { spotifyPort = null; });
  } else if (port.name === 'overlay') {
    overlayPorts.add(port);
    
    // Immediately send the current state to the newly opened tab
    if (lastKnownSong) {
      port.postMessage({
        type: 'SYNC_UPDATE',
        payload: { song: lastKnownSong, lyrics: lastKnownLyrics, settings: globalSettings }
      });
    }

    // Listen for UI toggle requests from any tab
    port.onMessage.addListener((msg: any) => {
      if (msg.type === 'TOGGLE_TRANSPARENT') {
        globalSettings.isTransparent = !globalSettings.isTransparent;
        saveAndBroadcastSettings();
      } else if (msg.type === 'TOGGLE_LOCK') {
        globalSettings.isLocked = !globalSettings.isLocked;
        saveAndBroadcastSettings();
      } else if (msg.type === 'UPDATE_POSITION') {
        // Only update if valid coordinates are provided
        if (msg.payload && typeof msg.payload.x === 'number') {
           globalSettings.position = msg.payload;
           saveAndBroadcastSettings();
        }
      } else if (msg.type === 'UPDATE_SIZE') {
        // Only update if valid dimensions are provided
        if (msg.payload && typeof msg.payload.width === 'number' && typeof msg.payload.height === 'number') {
           globalSettings.size = msg.payload;
           saveAndBroadcastSettings();
        }
      }
    });

    port.onDisconnect.addListener(() => { overlayPorts.delete(port); });
  }
});

async function handleSpotifyUpdate(songInfo: SongInfo) {
  lastKnownSong = songInfo;
  const cacheKey = `${songInfo.artist}-${songInfo.title}`.toLowerCase();
  
  let lyrics: LyricLine[] | null = lyricsCache.get(cacheKey) || null;

  if (!lyrics && !lyricsCache.has(cacheKey)) {
    try {
      const url = new URL('https://lrclib.net/api/get');
      url.searchParams.append('track_name', songInfo.title);
      url.searchParams.append('artist_name', songInfo.artist);

      const res = await fetch(url.toString());
      
      if (res.ok) {
        const data = await res.json();
        if (data.syncedLyrics) {
          lyrics = parseSyncedLyrics(data.syncedLyrics);
          lyricsCache.set(cacheKey, lyrics);
        } else {
          // Song exists in database, but has no synced lyrics
          lyricsCache.set(cacheKey, []); 
        }
      } else {
        // API returned 404 (Not Found) or 429 (Rate Limit). 
        // Cache as empty so we don't spam the API on the next 100ms tick.
        lyricsCache.set(cacheKey, []);
      }
    } catch (err) {
      // Cache as empty on network failure to prevent infinite retries
      lyricsCache.set(cacheKey, []);
    }
  }

  // --- RACE CONDITION FIX ---
  //race with the old song's fetch 
  // check if the global 'lastKnownSong' still matches the one we started this function with.
  const activeTrackKey = `${lastKnownSong?.artist}-${lastKnownSong?.title}`.toLowerCase();
  if (activeTrackKey !== cacheKey) {
    // This fetch belongs to an old song! 
    // Silently abort 
    return;
  }

  // If we made it here, this is still the active song. Update and broadcast!
  lastKnownLyrics = lyricsCache.get(cacheKey) || [];
  broadcastSync();
}

function broadcastSync() {
  if (!lastKnownSong) return;
  
  const payload = { 
    song: lastKnownSong, 
    lyrics: lastKnownLyrics,
    settings: globalSettings
  };

  for (const port of overlayPorts) {
    port.postMessage({ type: 'SYNC_UPDATE', payload });
  }
}

function parseSyncedLyrics(syncedLyrics: string): LyricLine[] {
  const lines = syncedLyrics.split('\n');
  const parsed: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2}\.\d{2})\]/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const timeMs = Math.floor((minutes * 60 + seconds) * 1000);
      const text = line.replace(timeRegex, '').trim();
      
      if (text) parsed.push({ timeMs, text });
    }
  }
  return parsed;
}