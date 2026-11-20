export interface SongInfo {
  title: string;
  artist: string;
  progressMs: number;
  isPlaying: boolean;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface UISettings {
  isTransparent: boolean;
  isLocked: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  fontSize: number;
  lyricColor: string;
  disabledDomains: string[];
}

// Spotify detection state, sent by the Spotify content script via the
// background worker so every overlay tab can fail loudly instead of
// silently returning null.
// - 'ok': a song is being read (via Media Session or the DOM).
// - 'idle': Spotify is not playing / no Spotify tab is open.
// - 'no-spotify': no Spotify tab is connected.
// - 'unreadable': Spotify is playing but no title/artist could be read
//   for 10s. The background then broadcasts a synthetic warning song
//   (see background/index.ts) so the overlay shows it.
export interface SpotifyStatus {
  state: 'ok' | 'no-spotify' | 'unreadable' | 'idle';
  isPlaying: boolean;
  detail?: string;
}

export interface SyncPayload {
  song: SongInfo;
  lyrics: LyricLine[] | null;
  settings: UISettings;
  spotifyStatus?: SpotifyStatus;
}
