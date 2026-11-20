//spotify.ts
// v2 (2026-11-20)
// 1. Media Session first: navigator.mediaSession.metadata is set by Spotify
//    for system media controls and does not depend on DOM testids.
// 2. DOM fallback with auto-discovery: if the known selectors fail while
//    Spotify is playing, scan the now-playing bar, verify candidates against
//    the Media Session title/artist, and cache the discovered selector in
//    chrome.storage.local as `discoveredSelectors` for the next load.
// 3. Fail loudly: if Spotify is playing but no song can be read for 10s,
//    send SPOTIFY_STATUS { state: 'unreadable' } so the background can make
//    every overlay show "Couldn't read song from Spotify" instead of vanishing.
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

// --- Selector lists -------------------------------------------------------
// Discovered selectors (from a previous auto-discovery run) go first,
// then the current bundled selectors, then the old ones as a last resort.
const BUNDLED_TITLE_SELECTORS = [
  '[data-testid="context-item-link"]',
  '[data-testid="context-item-info-title"]',
];
const BUNDLED_ARTIST_SELECTORS = [
  '[data-testid="now-playing-widget-v2-byline"]',
  '[data-testid="context-item-info-subtitles"]',
];

let discoveredTitleSelector: string | null = null;
let discoveredArtistSelector: string | null = null;

chrome.storage.local.get(['discoveredSelectors'], (result) => {
  const saved = result.discoveredSelectors as
    | { titleSelector?: string; artistSelector?: string }
    | undefined;
  if (saved?.titleSelector) discoveredTitleSelector = saved.titleSelector;
  if (saved?.artistSelector) discoveredArtistSelector = saved.artistSelector;
});

function titleSelectors(): string[] {
  return [
    ...(discoveredTitleSelector ? [discoveredTitleSelector] : []),
    ...BUNDLED_TITLE_SELECTORS,
  ];
}

function artistSelectors(): string[] {
  return [
    ...(discoveredArtistSelector ? [discoveredArtistSelector] : []),
    ...BUNDLED_ARTIST_SELECTORS,
  ];
}

function queryText(selector: string): string | null {
  const el = document.querySelector(selector);
  const text = el?.textContent?.trim();
  return text ? text : null;
}

// --- 1. Media Session -----------------------------------------------------
function getMediaSessionSong(): { title: string; artist: string; isPlaying: boolean } | null {
  try {
    const metadata = (navigator as any).mediaSession?.metadata as
      | { title?: string; artist?: string }
      | null
      | undefined;
    if (!metadata) return null;
    const title = metadata.title?.trim();
    const artist = metadata.artist?.trim();
    if (!title || !artist) return null;
    const playbackState = (navigator as any).mediaSession?.playbackState as string | undefined;
    return {
      title,
      artist,
      isPlaying: playbackState ? playbackState === 'playing' : getPlayButtonIsPlaying(),
    };
  } catch {
    return null;
  }
}

function getPlayButtonIsPlaying(): boolean {
  const playButton = document.querySelector('[data-testid="control-button-playpause"]');
  // Spotify's play button aria-label changes to "Pause" when music is actively playing
  return playButton?.getAttribute('aria-label') === 'Pause';
}

// --- DOM fallback ---------------------------------------------------------
function getDomSong(): { title: string; artist: string } | null {
  let title: string | null = null;
  for (const selector of titleSelectors()) {
    title = queryText(selector);
    if (title) break;
  }
  let artist: string | null = null;
  for (const selector of artistSelectors()) {
    artist = queryText(selector);
    if (artist) break;
  }
  if (!title || !artist) return null;
  return { title, artist };
}

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

// --- 2. Runtime auto-discovery -------------------------------------------
// Build a selector we can save and reuse for an element. Prefer its
// data-testid; otherwise fall back to a structural selector inside the
// now-playing bar (e.g. a[href*="/track/"] for the title link).
function selectorFor(el: Element): string | null {
  const testid = el.getAttribute('data-testid');
  if (testid) return `[data-testid="${testid}"]`;
  if (el.tagName === 'A') {
    const href = (el as HTMLAnchorElement).getAttribute('href') || '';
    if (href.includes('/track/')) return 'a[href*="/track/"]';
  }
  return null;
}

function discoverSelectors(
  expectedTitle: string | null,
  expectedArtist: string | null,
): { title: string; artist: string } | null {
  const bar =
    document.querySelector('[data-testid="now-playing-bar"]') ||
    document.querySelector('[data-testid="now-playing-widget-v2"]');
  if (!bar) return null;

  // Title: a link to /track/, or an element whose text matches the
  // Media Session title exactly.
  let titleEl: Element | null = null;
  let titleText: string | null = null;
  const links = bar.querySelectorAll('a');
  for (const link of links) {
    const text = link.textContent?.trim();
    if (!text) continue;
    const href = (link as HTMLAnchorElement).getAttribute('href') || '';
    if (href.includes('/track/') || (expectedTitle && text === expectedTitle)) {
      // If we have an expected title, a /track/ link with different text
      // is the wrong element (e.g. a playlist link) — skip it.
      if (expectedTitle && text !== expectedTitle) continue;
      titleEl = link;
      titleText = text;
      break;
    }
  }
  if (!titleEl || !titleText) return null;

  // Artist: the smallest element inside the bar whose text matches the
  // Media Session artist exactly. "Smallest" avoids picking the whole bar,
  // whose textContent also contains the artist.
  let artistEl: Element | null = null;
  let artistText: string | null = null;
  if (expectedArtist) {
    const all = bar.querySelectorAll('*');
    let bestLength = Infinity;
    for (const el of all) {
      if (el === titleEl) continue;
      const text = el.textContent?.trim();
      if (text !== expectedArtist) continue;
      // Prefer leaf-ish elements: skip parents that merely contain the match.
      if (el.children.length > 3) continue;
      if (text.length < bestLength) {
        bestLength = text.length;
        artistEl = el;
        artistText = text;
      }
    }
    if (!artistEl || !artistText) return null;
  } else {
    // No Media Session to verify against: accept the byline-style element
    // if it has a testid mentioning byline/artist, otherwise give up
    // rather than guessing wrong.
    const byline = bar.querySelector('[data-testid*="byline"], [data-testid*="artist"]');
    const text = byline?.textContent?.trim();
    if (!byline || !text || text === titleText) return null;
    artistEl = byline;
    artistText = text;
  }

  // Save what we found so the next load tries it first.
  const titleSelector = selectorFor(titleEl);
  const artistSelector = selectorFor(artistEl);
  if (titleSelector && artistSelector) {
    discoveredTitleSelector = titleSelector;
    discoveredArtistSelector = artistSelector;
    try {
      chrome.storage.local.set({
        discoveredSelectors: {
          titleSelector,
          artistSelector,
          savedAt: Date.now(),
        },
      });
    } catch {
      // Storage failing must not break song detection.
    }
  }

  return { title: titleText, artist: artistText };
}

// --- Status / fail-loudly state ------------------------------------------
const UNREADABLE_AFTER_MS = 10000;
const DISCOVERY_EVERY_MS = 5000;

let firstUnreadableAt = 0;
let lastDiscoveryAt = 0;
let lastStatusSent: string | null = null;

function postStatus(state: 'ok' | 'unreadable' | 'idle', isPlaying: boolean, detail?: string) {
  if (lastStatusSent === state) return;
  lastStatusSent = state;
  try {
    port?.postMessage({ type: 'SPOTIFY_STATUS', payload: { state, isPlaying, detail } });
  } catch {
    // Port may be reconnecting; the next poll will retry via the status change.
    lastStatusSent = null;
  }
}

function sendPlaybackUpdate() {
  const mediaSong = getMediaSessionSong();

  // 1. Media Session first.
  if (mediaSong) {
    firstUnreadableAt = 0;
    // Verified discovery: while Media Session is giving us the true
    // title/artist, learn which DOM elements hold them — verified by
    // exact text match — so a future load still works even if
    // Media Session is ever empty. Throttled, and only when the known
    // DOM selectors are not already finding the song.
    if (!getDomSong()) {
      const nowForDiscovery = Date.now();
      if (nowForDiscovery - lastDiscoveryAt >= DISCOVERY_EVERY_MS) {
        lastDiscoveryAt = nowForDiscovery;
        discoverSelectors(mediaSong.title, mediaSong.artist);
      }
    }
    const songInfo: SongInfo = {
      title: mediaSong.title,
      artist: mediaSong.artist,
      progressMs: getPlaybackProgressMs(),
      isPlaying: mediaSong.isPlaying,
    };
    postStatus('ok', songInfo.isPlaying);
    try {
      port?.postMessage({ type: 'SONG_CHANGED', payload: songInfo });
    } catch {
      // Port reconnect will pick it up on the next poll.
    }
    return;
  }

  // 2. DOM selectors (discovered first, then bundled, then old).
  const domSong = getDomSong();
  if (domSong) {
    firstUnreadableAt = 0;
    const songInfo: SongInfo = {
      title: domSong.title,
      artist: domSong.artist,
      progressMs: getPlaybackProgressMs(),
      isPlaying: getPlayButtonIsPlaying(),
    };
    postStatus('ok', songInfo.isPlaying);
    try {
      port?.postMessage({ type: 'SONG_CHANGED', payload: songInfo });
    } catch {
      // Port reconnect will pick it up on the next poll.
    }
    return;
  }

  // 3. Auto-discovery, throttled so it does not scan the DOM every 100ms.
  // We have no Media Session title to verify against here, so discovery
  // uses the structural /track/ link + byline heuristic and only accepts
  // a clean title/artist pair.
  const now = Date.now();
  if (now - lastDiscoveryAt >= DISCOVERY_EVERY_MS) {
    lastDiscoveryAt = now;
    const discovered = discoverSelectors(null, null);
    if (discovered) {
      firstUnreadableAt = 0;
      const songInfo: SongInfo = {
        title: discovered.title,
        artist: discovered.artist,
        progressMs: getPlaybackProgressMs(),
        isPlaying: getPlayButtonIsPlaying(),
      };
      postStatus('ok', songInfo.isPlaying);
      try {
        port?.postMessage({ type: 'SONG_CHANGED', payload: songInfo });
      } catch {
        // Port reconnect will pick it up on the next poll.
      }
      return;
    }
  }

  // 4. No song readable. Only fail loudly when Spotify is actually playing.
  const isPlaying = getPlayButtonIsPlaying();
  if (!isPlaying) {
    firstUnreadableAt = 0;
    postStatus('idle', false);
    return;
  }

  if (!firstUnreadableAt) firstUnreadableAt = now;
  if (now - firstUnreadableAt >= UNREADABLE_AFTER_MS) {
    postStatus(
      'unreadable',
      true,
      'Spotify is playing but no title/artist could be read (Media Session empty, known selectors failed, auto-discovery found nothing).',
    );
  }
}

// Poll the DOM every 100ms to send real-time synchronization updates
setInterval(sendPlaybackUpdate, 100);
