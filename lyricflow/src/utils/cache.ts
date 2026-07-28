// src/utils/cache.ts
interface CachedLyric {
  lyrics: string;
  timestamp: number;
}

const CACHE_PREFIX = "lf_lyric_";
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export const LyricCache = {
  getKey: (artist: string, track: string) => 
    `${CACHE_PREFIX}${artist}_${track}`.toLowerCase().replace(/[^a-z0-9]/g, '_'),

  async get(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    const data = result[key] as CachedLyric;
    
    if (!data) return null;

    // Cache Eviction: If older than 3 days, delete it and return null
    if (Date.now() - data.timestamp > MAX_AGE_MS) {
      await chrome.storage.local.remove(key);
      return null;
    }
    return data.lyrics;
  },

  async set(key: string, lyrics: string): Promise<void> {
    await chrome.storage.local.set({ 
      [key]: { lyrics, timestamp: Date.now() } 
    });
  }
};