import { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { SyncPayload } from '../types';
import styles from './overlay.css?inline';

const PRE_ROLL_OFFSET_MS = 1400; 

const OverlayApp = () => {
  const [data, setData] = useState<SyncPayload | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const prevTrackRef = useRef<string>('');

  // Local UI State for 60fps Dragging & Resizing
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [localPos, setLocalPos] = useState({ x: 20, y: 20 });
  const [localSize, setLocalSize] = useState({ width: 380, height: 120 });
  
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const resizeStartRef = useRef({ startWidth: 0, startHeight: 0, startX: 0, startY: 0 });

  useEffect(() => {
    const connectPort = () => {
      const port = chrome.runtime.connect({ name: 'overlay' });
      portRef.current = port;

      port.onMessage.addListener((msg: any) => {
        if (msg.type === 'SYNC_UPDATE') {
          setData(msg.payload);
        }
      });

      port.onDisconnect.addListener(() => {
        setTimeout(connectPort, 1000);
      });
    };

    connectPort();
    return () => { if (portRef.current) portRef.current.disconnect(); };
  }, []);

  // Sync local states with global worker settings ONLY when not interacting
  useEffect(() => {
    if (!isDragging && data?.settings?.position) {
      setLocalPos(data.settings.position);
    }
    if (!isResizing && data?.settings?.size) {
      setLocalSize(data.settings.size);
    }
  }, [data?.settings?.position, data?.settings?.size, isDragging, isResizing]);

  
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
        setLocalPos({
          x: e.clientX - dragStartOffset.current.x,
          y: e.clientY - dragStartOffset.current.y
        });
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
        const finalPos = { x: e.clientX - dragStartOffset.current.x, y: e.clientY - dragStartOffset.current.y };
        if (portRef.current) portRef.current.postMessage({ type: 'UPDATE_POSITION', payload: finalPos });
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
  }, [isDragging, isResizing]);


  if (!data || !data.song) return null;

  const { song, lyrics, settings } = data;
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
    currentLine = "Fetching lyrics...";
    nextLine = "";
  }

  const containerClasses = [
    'lyricflow-container',
    settings?.isTransparent ? 'is-transparent' : '',
    settings?.isLocked ? 'is-locked' : ''
  ].filter(Boolean).join(' ');

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
        // Disable transitions during drag/resize so the box perfectly hugs the mouse cursor
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
        
        <div className="header-controls">
          <button className="control-btn" onClick={handleToggleTransparent} onMouseDown={e => e.stopPropagation()} title="Toggle Transparency">
            {settings?.isTransparent ? '👁️' : '🕶️'}
          </button>
          <button className="control-btn lock-btn" onClick={handleToggleLock} onMouseDown={e => e.stopPropagation()} title="Lock & Click-Through">
            {settings?.isLocked ? '🔒' : '🔓'}
          </button>
        </div>
      </div>
      
      <div className="lyric-body">
        <div className="lyricflow-current fade-in-line" key={`current-${currentLine}`}>
          ▶ {currentLine}
        </div>
        
        {nextLine && (
          <div className="lyricflow-next" key={`next-${nextLine}`}>
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