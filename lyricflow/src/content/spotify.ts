//spotify.ts
// Fix 2026-11-20: Spotify renamed the now-playing testids.
// Old: context-item-info-title / context-item-info-subtitles (gone from the DOM)
// New: context-item-link (song title) / now-playing-widget-v2-byline (artist)
// Verified live on open.spotify.com: 'MISS ME' / 'keshi'
// Old selectors kept as fallback in case Spotify rolls back / serves the old UI.
import type { SongInfo } from '../types';

let port: chrome.runtime.Port;

function setupPort() {
  port = chrome.runtime.connect({ name: 'spotify' });

  // Listen for media commands forwarded from the background worker
  port.onMessage.addListener((msg: any) => {
    if (msg.type === 'TOGGLE_PLAYBACK') {
      const playPauseBtn = document.querySelector('[data-testid="control-button-playpause"]') as HTMLButtonElement;
      playPauseBtn?.click();
    } else if (msg.type === 'NEXT_SONG') {
      const nextBtn = document.querySelector('[data-testid="control-button-skip-forward"]') as HTMLButtonElement;
      nextBtn?.click();
    } else if (msg.type === 'PREV_SONG') {
      const prevBtn = document.querySelector('[data-testid="control-button-skip-back"]') as HTMLButtonElement;
      prevBtn?.click();
    }
  });

  // Re-establish port and re-bind listeners if disconnected
  port.onDisconnect.addListener(() => {
    setupPort();
  });
}

// Initialize port connection
setupPort();

// Helper function to parse "01:24" into 84000 milliseconds
function getPlaybackProgressMs(): number {
  const timeEl = document.querySelector('[data-testid="playback-position"]');
  if (!timeEl || !timeEl.textContent) return 0;
  
  const parts = timeEl.textContent.split(':').map(Number);
  if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  }
  return 0;
}

function sendPlaybackUpdate() {
  const titleEl = document.querySelector('[data-testid="context-item-link"]')
    || document.querySelector('[data-testid="context-item-info-title"]');
  const artistEl = document.querySelector('[data-testid="now-playing-widget-v2-byline"]')
    || document.querySelector('[data-testid="context-item-info-subtitles"]');
  const playButton = document.querySelector('[data-testid="control-button-playpause"]');

  if (titleEl && artistEl) {
    // Spotify's play button aria-label changes to "Pause" when music is actively playing
    const isPlaying = playButton?.getAttribute('aria-label') === 'Pause';

    const songInfo: SongInfo = {
      title: titleEl.textContent || "",
      artist: artistEl.textContent || "",
      progressMs: getPlaybackProgressMs(),
      isPlaying
    };

    port.postMessage({ type: 'SONG_CHANGED', payload: songInfo });
  }
}

// Poll the DOM every 500ms to send real-time synchronization updates
setInterval(sendPlaybackUpdate, 100);
