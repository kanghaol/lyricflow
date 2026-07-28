//src/api/lrclib.ts
const LRCLIB_USER_AGENT = "LyricFlow Chrome Extension/1.0.0 (https://github.com/kanghaol/LyricFlow)";
const API_TIMEOUT_MS = 5000; // 5 seconds max

export async function fetchLyrics(artist: string, track: string): Promise<string> {
  const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "Lrclib-Client": LRCLIB_USER_AGENT },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status === 429) throw new Error("RATE_LIMITED");
    if (response.status === 404) throw new Error("NOT_FOUND");
    if (!response.ok) throw new Error("NETWORK_ERROR");

    const data = await response.json();
    return data.syncedLyrics || data.plainLyrics || "";
    
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error("TIMEOUT");
    throw error;
  }
}