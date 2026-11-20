// src/background/index.ts
import { fetchLyrics } from '../api/lrclib';
import type { SongInfo, LyricLine, UISettings, SpotifyStatus } from '../types';
import { LyricCache } from '../utils/cache';

let spotifyPort: chrome.runtime.Port | null = null;
const overlayPorts: Set<chrome.runtime.Port> = new Set();
const memoryCache = new Map<string, string>();
const MAX_MEMORY_CACHE_SIZE = 25;

// Global UI State
let DEFAULT_SETTINGS: UISettings = {
  isTransparent: false,
  isLocked: false,
  position: { x: 20, y: 20 },
  size: { width: 380, height: 120 },
  fontSize: 17,
  lyricColor: '#1DB954',
  disabledDomains: []
};

let globalSettings: UISettings = { ...DEFAULT_SETTINGS };

chrome.storage.local.get(['lyricflow_settings'], (result) => {
  if (result.lyricflow_settings) {
    globalSettings = { ...globalSettings, ...result.lyricflow_settings };
  }
});

// Listen for storage changes to disable or resume syncing
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.extensionEnabled) {
    broadcastSync();
  }
});

// Helper function to save settings to storage and broadcast to all overlay ports
function saveAndBroadcastSettings() {
  chrome.storage.local.set({ lyricflow_settings: globalSettings });
  broadcastSync();
}

// Store the last known song state to broadcast immediately when a new tab opens
let lastKnownSong: SongInfo | null = null;
let lastKnownLyrics: LyricLine[] | null = null;

// Spotify detection state (see src/types/index.ts). The Spotify content
// script reports 'ok' / 'idle' / 'unreadable'; 'no-spotify' means no
// Spotify tab is connected at all.
let spotifyStatus: SpotifyStatus = { state: 'no-spotify', isPlaying: false };

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Listen for global media commands sent from the overlay buttons
chrome.runtime.onMessage.addListener((message) => {
  if (['TOGGLE_PLAYBACK', 'NEXT_SONG', 'PREV_SONG'].includes(message.type)) {
    if (spotifyPort) {
      try {
        spotifyPort.postMessage({ type: message.type });
      } catch (err) {
        spotifyPort = null;
      }
    }
  }
});

// Build the payload every overlay receives. Fail loudly (requirement 3):
// when Spotify is playing but unreadable, broadcast a synthetic warning
// song instead of song: null, so the overlay shows
// "Couldn't read song from Spotify" instead of silently returning null.
// This synthetic song is only ever in the broadcast payload — it never
// overwrites lastKnownSong and never triggers a lyrics fetch.
function buildPayload(isEnabled: boolean) {
  if (!isEnabled) {
    return {
      song: null,
      lyrics: null,
      settings: globalSettings,
      spotifyStatus: { state: 'idle', isPlaying: false } as SpotifyStatus,
    };
  }

  if (spotifyStatus.state === 'unreadable') {
    return {
      song: {
        title: "Couldn't read song from Spotify",
        artist: 'Spotify changed its layout',
        progressMs: 0,
        isPlaying: false,
      } as SongInfo,
      lyrics: [
        {
          timeMs: 0,
          text: 'LyricFlow is trying new selectors — detection should resume automatically.',
        },
      ] as LyricLine[],
      settings: globalSettings,
      spotifyStatus,
    };
  }

  return {
    song: lastKnownSong,
    lyrics: lastKnownLyrics,
    settings: globalSettings,
    spotifyStatus,
  };
}

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name === 'spotify') {
    spotifyPort = port;
    spotifyStatus = { state: 'idle', isPlaying: false };
    port.onMessage.addListener((msg: any) => {
      if (msg.type === 'SONG_CHANGED') {
        spotifyStatus = { state: 'ok', isPlaying: msg.payload?.isPlaying ?? false };
        handleSpotifyUpdate(msg.payload);
      } else if (msg.type === 'SPOTIFY_STATUS') {
        // Only accept the states the Spotify content script actually sends.
        const state = msg.payload?.state;
        if (state === 'ok' || state === 'idle' || state === 'unreadable') {
          spotifyStatus = {
            state,
            isPlaying: !!msg.payload?.isPlaying,
            detail: msg.payload?.detail,
          };
          broadcastSync();
        }
      }
    });

    port.onDisconnect.addListener(() => {
      spotifyPort = null;
      spotifyStatus = { state: 'no-spotify', isPlaying: false };
      lastKnownSong = null;
      lastKnownLyrics = null;
      broadcastSync();
    });

  } else if (port.name === 'overlay') {
    overlayPorts.add(port);

    // Immediately send the current state to the newly opened tab
    // v2: always send it — including the unreadable warning — not only
    // when a song is already known.
    chrome.storage.local.get(['extensionEnabled'], (result) => {
      const isEnabled = result.extensionEnabled !== false;
      port.postMessage({ type: 'SYNC_UPDATE', payload: buildPayload(isEnabled) });
    });

    // Listen for UI toggle requests from any tab
    port.onMessage.addListener((msg: any) => {
      if (msg.type === 'REQUEST_SYNC') {
        // SLEEP MODE FIX: Send the current state immediately to the tab requesting a sync
        chrome.storage.local.get(['extensionEnabled'], (result) => {
          const isEnabled = result.extensionEnabled !== false;
          port.postMessage({ type: 'SYNC_UPDATE', payload: buildPayload(isEnabled) });
        });
      } else if (msg.type === 'TOGGLE_TRANSPARENT') {
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
      } else if (msg.type === 'UPDATE_STYLE' && msg.payload) {
        globalSettings.fontSize = msg.payload.fontSize;
        globalSettings.lyricColor = msg.payload.lyricColor;
        saveAndBroadcastSettings();
      } else if (msg.type === 'RESET_STYLES') {
        // Reset visual styles to default values
        globalSettings.fontSize = DEFAULT_SETTINGS.fontSize;
        globalSettings.lyricColor = DEFAULT_SETTINGS.lyricColor;
        saveAndBroadcastSettings();
      } else if (msg.type === 'TOGGLE_DOMAIN_DISABLED' && msg.payload?.domain) {
        const domain = msg.payload.domain;
        const index = globalSettings.disabledDomains.indexOf(domain);
        if (index > -1) {
          globalSettings.disabledDomains.splice(index, 1); // Enable domain
        } else {
          globalSettings.disabledDomains.push(domain);     // Disable domain
        }
        saveAndBroadcastSettings();
      }
    });

    port.onDisconnect.addListener(() => { overlayPorts.delete(port); });
  }
});

// helper function for in memory caching with eviction policy
function getMemoryCache(key: string): string | null {
  const value = memoryCache.get(key);
  return value ?? null;
}

function setMemoryCache(key: string, lyrics: string) {
  // If key already exists, delete it first so it becomes the newest entry
  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  }

  memoryCache.set(key, lyrics);

  // Evict the oldest entry if over capacity
  if (memoryCache.size > MAX_MEMORY_CACHE_SIZE) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey !== undefined) {
      memoryCache.delete(oldestKey);
    }
  }
}

async function handleSpotifyUpdate(songInfo: SongInfo) {
  const isNewTrack =
    lastKnownSong?.title !== songInfo.title ||
    lastKnownSong?.artist !== songInfo.artist;

  lastKnownSong = songInfo;

  // 2. If it's the exact same song, just broadcast the new time to the UI and STOP.
  if (!isNewTrack) {
    broadcastSync();
    return;
  }

  // 1. Generate key from cache.ts module (Duration removed)
  const cacheKey = LyricCache.getKey(songInfo.artist, songInfo.title);

  // Clear previous timer if the user skips rapidly
  if (debounceTimer) clearTimeout(debounceTimer);

  try {

    // 1. Check in-memory cache first
    const memoryLyrics = getMemoryCache(cacheKey);

    if (memoryLyrics !== null) {
      // console.log("Serving from memory:", cacheKey);

      lastKnownLyrics = memoryLyrics
        ? parseSyncedLyrics(memoryLyrics)
        : [];

      broadcastSync();
      return;
    }

    // 2. Fall back to persistent Chrome storage
    const cachedLyricsStr = await LyricCache.get(cacheKey);

    if (cachedLyricsStr !== null) {
      // console.log("Serving from storage:", cacheKey); 

      // add into RAM cache
      setMemoryCache(cacheKey, cachedLyricsStr);

      lastKnownLyrics = cachedLyricsStr
        ? parseSyncedLyrics(cachedLyricsStr)
        : [];

      broadcastSync();
      return;
    }

    // Temporarily clear lyrics to show a loading state on the UI
    lastKnownLyrics = null;
    broadcastSync();

    // 3. Debounce network requests by 1.5 seconds
    debounceTimer = setTimeout(async () => {
      // Make sure the track didn't change while we were waiting (Duration removed)
      const activeTrackKey = LyricCache.getKey(lastKnownSong?.artist || '', lastKnownSong?.title || '');
      if (activeTrackKey !== cacheKey) return;

      try {

        const lyricsStr = await fetchLyrics(songInfo.artist, songInfo.title);

        // Save to storage cache
        await LyricCache.set(cacheKey, lyricsStr);
        // save to in-memory cache
        setMemoryCache(cacheKey, lyricsStr);

        lastKnownLyrics = lyricsStr ? parseSyncedLyrics(lyricsStr) : [];
        broadcastSync();

      } catch (error: any) {
        if (error.message === "RATE_LIMITED") {
          lastKnownLyrics = [{ timeMs: 0, text: "Rate limited. Please wait a moment." }];
        } else if (error.message === "NOT_FOUND") {
          await LyricCache.set(cacheKey, ""); // Cache the empty result
          setMemoryCache(cacheKey, "");
          lastKnownLyrics = [];
        } else {
          lastKnownLyrics = [{ timeMs: 0, text: "Network error fetching lyrics." }];
        }
        broadcastSync();
      }
    }, 1500);

  } catch (err) {
    console.error("Pipeline error:", err);
  }
}

function broadcastSync() {
  chrome.storage.local.get(['extensionEnabled'], (result) => {
    const isEnabled = result.extensionEnabled !== false;
    const payload = buildPayload(isEnabled);

    for (const port of overlayPorts) {
      port.postMessage({ type: 'SYNC_UPDATE', payload });
    }
  });
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
