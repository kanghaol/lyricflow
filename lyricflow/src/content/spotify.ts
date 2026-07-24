//spotify.ts
import type { SongInfo } from '../types';

let port = chrome.runtime.connect({ name: 'spotify' });

port.onDisconnect.addListener(() => {
  port = chrome.runtime.connect({ name: 'spotify' });
});

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
  const titleEl = document.querySelector('[data-testid="context-item-info-title"]');
  const artistEl = document.querySelector('[data-testid="context-item-info-subtitles"]');
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