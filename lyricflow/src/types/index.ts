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
}

export interface SyncPayload {
  song: SongInfo;
  lyrics: LyricLine[] | null;
  settings: UISettings;
}