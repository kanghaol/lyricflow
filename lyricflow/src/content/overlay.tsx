import { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { SyncPayload } from '../types';
import styles from './overlay.css?inline';

const PRE_ROLL_OFFSET_MS = 1400;

const OverlayApp = () => {
  const [data, setData] = useState<SyncPayload | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [currentDomain, setCurrentDomain] = useState<string | null>(null);
  const prevTrackRef = useRef<string>('');

  // Local UI State for Dragging & Resizing
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  
  // Track window dimensions dynamically to instantly handle zoom changes
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [localPos, setLocalPos] = useState({
    x: Math.max(0, window.innerWidth / 2 - 190),
    y: Math.max(0, window.innerHeight - 150)
  });
  const [localSize, setLocalSize] = useState({ width: 380, height: 120 });

  const dragStartOffset = useRef({ x: 0, y: 0 });
  const resizeStartRef = useRef({ startWidth: 0, startHeight: 0, startX: 0, startY: 0 });

  // Helper: Prevents the overlay from getting lost off-screen
  const clampPosition = (x: number, y: number, width: number, height: number) => {
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height))
    };
  };

  // 1. SLEEP MODE & TAB SYNC FIX
  useEffect(() => {
    setCurrentDomain(window.location.hostname);
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connectPort = () => {
      if (portRef.current) {
        portRef.current.disconnect();
      }

      try {
        const port = chrome.runtime.connect({ name: 'overlay' });
        portRef.current = port;

        port.onMessage.addListener((msg: any) => {
          if (msg.type === 'SYNC_UPDATE') {
            setData(msg.payload);
          }
        });

        port.onDisconnect.addListener(() => {
          portRef.current = null;
          clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connectPort, 1000);
        });

        port.postMessage({ type: 'REQUEST_SYNC' });
      } catch (error) {
        console.log("LyricFlow: Extension context invalidated, waiting for refresh.");
      }
    };

    connectPort();

    const handleWakeAndFocus = () => {
      if (!document.hidden) {
        if (!portRef.current) {
          connectPort();
        } else {
          try {
            portRef.current.postMessage({ type: 'REQUEST_SYNC' });
          } catch (e) {
            connectPort();
          }
        }
      }
    };

    window.addEventListener('focus', handleWakeAndFocus);
    document.addEventListener('visibilitychange', handleWakeAndFocus);

    return () => {
      clearTimeout(reconnectTimeout);
      window.removeEventListener('focus', handleWakeAndFocus);
      document.removeEventListener('visibilitychange', handleWakeAndFocus);
      if (portRef.current) portRef.current.disconnect();
    };
  }, []);

  // Track window resizing/zooming to trigger re-calculations
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 2. ZOOM RELATIVE POSITIONING FIX
  // Map the globally saved percentages back to the current tab's exact dimensions
  useEffect(() => {
    if (!isDragging && data?.settings?.position) {
      const pos = data.settings.position as any; 

      // If no custom drag has happened yet (worker default)
      if (pos.x === 20 && pos.y === 20 && pos.pctX === undefined) {
        setLocalPos({
          x: Math.max(0, windowSize.w / 2 - (localSize.width / 2)),
          y: Math.max(0, windowSize.h - localSize.height - 30)
        });
      } 
      // If we have saved relative percentages from a previous drag
      else if (pos.pctX !== undefined && pos.pctY !== undefined) {
        const mappedX = pos.pctX * Math.max(0, windowSize.w - localSize.width);
        const mappedY = pos.pctY * Math.max(0, windowSize.h - localSize.height);
        setLocalPos(clampPosition(mappedX, mappedY, localSize.width, localSize.height));
      } 
      // Legacy fallback
      else {
        setLocalPos(clampPosition(pos.x, pos.y, localSize.width, localSize.height));
      }
    }
    
    if (!isResizing && data?.settings?.size) {
      setLocalSize(data.settings.size);
    }
  }, [data?.settings?.position, data?.settings?.size, isDragging, isResizing, localSize.width, localSize.height, windowSize]);

  const handleDragStart = (e: React.MouseEvent) => {
    if (data?.settings?.isLocked) return;
    setIsDragging(true);
    dragStartOffset.current = { x: e.clientX - localPos.x, y: e.clientY - localPos.y };
    e.stopPropagation();
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    if (data?.settings?.isLocked) return;
    setIsResizing(true);
    resizeStartRef.current = {
      startWidth: localSize.width,
      startHeight: localSize.height,
      startX: e.clientX,
      startY: e.clientY
    };
    e.stopPropagation();
    e.preventDefault();
  };

  // Global Mouse Tracking
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const rawX = e.clientX - dragStartOffset.current.x;
        const rawY = e.clientY - dragStartOffset.current.y;
        setLocalPos(clampPosition(rawX, rawY, localSize.width, localSize.height));
      } else if (isResizing) {
        setLocalSize({
          width: Math.max(280, resizeStartRef.current.startWidth + (e.clientX - resizeStartRef.current.startX)),
          height: Math.max(120, resizeStartRef.current.startHeight + (e.clientY - resizeStartRef.current.startY))
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isDragging) {
        setIsDragging(false);
        const rawX = e.clientX - dragStartOffset.current.x;
        const rawY = e.clientY - dragStartOffset.current.y;
        const finalPos = clampPosition(rawX, rawY, localSize.width, localSize.height);
        
        // Calculate the screen percentage based on available real estate
        const pctX = finalPos.x / Math.max(1, window.innerWidth - localSize.width);
        const pctY = finalPos.y / Math.max(1, window.innerHeight - localSize.height);

        // Inject the proportional ratios into the payload
        if (portRef.current) {
          portRef.current.postMessage({ 
            type: 'UPDATE_POSITION', 
            payload: { x: finalPos.x, y: finalPos.y, pctX, pctY } 
          });
        }
      }
      if (isResizing) {
        setIsResizing(false);
        const finalWidth = Math.max(280, resizeStartRef.current.startWidth + (e.clientX - resizeStartRef.current.startX));
        const finalHeight = Math.max(120, resizeStartRef.current.startHeight + (e.clientY - resizeStartRef.current.startY));
        if (portRef.current) portRef.current.postMessage({ type: 'UPDATE_SIZE', payload: { width: finalWidth, height: finalHeight } });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, localSize.width, localSize.height]);

  if (!data || !data.song) return null;

  const { song, lyrics, settings } = data;

  if (currentDomain && settings?.disabledDomains?.includes(currentDomain)) {
    return null;
  }
  const currentTrackId = `${song.title}-${song.artist}`;

  if (prevTrackRef.current !== currentTrackId) {
    prevTrackRef.current = currentTrackId;
  }

  let currentLine = "Instrumental / No Lyrics";
  let nextLine = "";
  const isFetching = lyrics === null;

  if (lyrics && lyrics.length > 0) {
    const adjustedProgress = song.progressMs + PRE_ROLL_OFFSET_MS;
    if (adjustedProgress < lyrics[0].timeMs) {
      currentLine = "•••";
      nextLine = lyrics[0].text;
    } else {
      const activeIndex = lyrics.findIndex((line, index) => {
        const isLast = index === lyrics.length - 1;
        const nextTime = isLast ? Infinity : lyrics[index + 1].timeMs;
        return adjustedProgress >= line.timeMs && adjustedProgress < nextTime;
      });

      if (activeIndex !== -1) {
        currentLine = lyrics[activeIndex].text;
        if (activeIndex + 1 < lyrics.length) {
          nextLine = lyrics[activeIndex + 1].text;
        }
      }
    }
  } else if (isFetching) {
    currentLine = "Searching for lyrics...";
    nextLine = "";
  }

  let containerClasses = 'lyricflow-container';

  if (settings?.isTransparent) {
    containerClasses += ' is-transparent';
  }

  if (settings?.isLocked) {
    containerClasses += ' is-locked';
  }

  const handleToggleTransparent = () => {
    if (portRef.current) portRef.current.postMessage({ type: 'TOGGLE_TRANSPARENT' });
  };

  const handleToggleLock = () => {
    if (portRef.current) portRef.current.postMessage({ type: 'TOGGLE_LOCK' });
  };

  return (
    <div
      className={containerClasses}
      style={{
        left: `${localPos.x}px`,
        top: `${localPos.y}px`,
        width: `${localSize.width}px`,
        height: `${localSize.height}px`,
        pointerEvents: settings?.isLocked ? 'none' : 'auto',
        transition: (isDragging || isResizing) ? 'none' : 'background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease'
      }}
    >
      <div
        className={`lyricflow-header ${!settings?.isLocked ? 'is-draggable' : ''}`}
        onMouseDown={handleDragStart}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          🎵 {song.title} — {song.artist}
        </span>

        <div
          className="header-controls"
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '16px',
            marginLeft: 'auto'
          }}
        >
          {/* Previous Button */}
          <button
            onClick={() => chrome.runtime.sendMessage({ type: 'PREV_SONG' }).catch(() => { })}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.7, transition: 'all 0.2s', display: 'flex', alignItems: 'center' }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
            title="Previous"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          {/* Play / Pause Button */}
          <button
            onClick={() => chrome.runtime.sendMessage({ type: 'TOGGLE_PLAYBACK' }).catch(() => { })}
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'; e.currentTarget.style.transform = 'scale(1.05)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; e.currentTarget.style.transform = 'scale(1)'; }}
            title={song?.isPlaying ? "Pause" : "Play"}
          >
            {song?.isPlaying ? (
              /* Pause Icon */
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              /* Play Icon */
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Next Button */}
          <button
            onClick={() => chrome.runtime.sendMessage({ type: 'NEXT_SONG' }).catch(() => { })}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.7, transition: 'all 0.2s', display: 'flex', alignItems: 'center' }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
            title="Next"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>

          {/* Transparency Toggle */}
          <button
            className="control-btn"
            onClick={handleToggleTransparent}
            onMouseDown={e => e.stopPropagation()}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.7, transition: 'all 0.2s', display: 'flex', alignItems: 'center' }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
            title={settings?.isTransparent ? "Solid Background" : "Transparent Background"}
          >
            {settings?.isTransparent ? (
              /* Visibility Off / Transparent Icon */
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
              </svg>
            ) : (
              /* Visibility On / Solid Icon */
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
              </svg>
            )}
          </button>

          {/* Lock Toggle */}
          <button
            className="control-btn lock-btn"
            onClick={handleToggleLock}
            onMouseDown={e => e.stopPropagation()}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.7, transition: 'all 0.2s', display: 'flex', alignItems: 'center' }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
            title={settings?.isLocked ? "Unlock UI" : "Lock & Click-Through"}
          >
            {settings?.isLocked ? (
              /* Locked Icon */
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
              </svg>
            ) : (
              /* Unlocked Icon */
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z" />
              </svg>
            )}
          </button>

          {/* Power / Turn Off Button */}
          <button
            onClick={() => {
              chrome.storage.local.set({ extensionEnabled: false });
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ff4d4d',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.8,
              transition: 'opacity 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
            title="Turn off LyricFlow"
          >
            {/* Power / Close SVG Icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.41L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="lyric-body">
        <div
          className="lyricflow-current fade-in-line"
          key={`current-${currentLine}`}
          style={{
            fontSize: `${settings?.fontSize}px`,
            color: settings?.lyricColor,
            fontWeight: 'bold',
            textShadow: '0px 2px 4px rgba(0, 0, 0, 0.9), 0px 0px 2px rgba(0, 0, 0, 1)'
          }}
        >
          ▶ {currentLine}
        </div>

        {nextLine && (
          <div
            className="lyricflow-next"
            key={`next-${nextLine}`}
            style={{
              fontSize: `${(settings?.fontSize || 17) * 0.82}px`,
              color: '#aaaaaa',
              marginTop: '4px',
              textShadow: '0px 1px 3px rgba(0, 0, 0, 0.8)'
            }}
          >
            {nextLine}
          </div>
        )}
      </div>

      {/* Resize Handle at Bottom Right */}
      <div className="resize-handle" onMouseDown={handleResizeStart}>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ fill: '#aef56c' }}>
          <path d="M10 10H0V8.5h8.5V0H10v10z" />
        </svg>
      </div>
    </div>
  );
};

// --- Shadow DOM Initialization ---
const host = document.createElement('div');
host.id = 'lyricflow-extension-root';
document.body.appendChild(host);

const shadowRoot = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = styles;
shadowRoot.appendChild(style);

const renderTarget = document.createElement('div');
shadowRoot.appendChild(renderTarget);

const root = createRoot(renderTarget);
root.render(<OverlayApp />);