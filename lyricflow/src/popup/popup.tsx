import { createRoot } from 'react-dom/client';
import { useEffect, useState, useRef } from 'react';
import type { SyncPayload } from '../types';

// High-visibility colors 
const VISIBLE_COLOR_OPTIONS = [
  { name: 'Pure White', hex: '#FFFFFF' },
  { name: 'Electric Yellow', hex: '#FFE600' },
  { name: 'Neon Cyan', hex: '#00F0FF' },
  { name: 'Vibrant Green', hex: '#39FF14' },
  { name: 'Hot Pink', hex: '#FF007F' },
  { name: 'Bright Gold', hex: '#FF9900' }
];

export default function Popup() {
  const [data, setData] = useState<SyncPayload | null>(null);
  const [currentDomain, setCurrentDomain] = useState<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [isEnabled, setIsEnabled] = useState<boolean>(true);

  useEffect(() => {
    chrome.storage.local.get(['extensionEnabled'], (result) => {
      setIsEnabled(result.extensionEnabled !== false);
    });
  }, []);

  useEffect(() => {
    // Get active tab URL and extract domain
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        try {
          const url = new URL(tabs[0].url);
          setCurrentDomain(url.hostname);
        } catch (e) {
          console.error("Invalid URL", e);
        }
      }
    });

    const port = chrome.runtime.connect({ name: 'overlay' });
    portRef.current = port;

    port.onMessage.addListener((msg: any) => {
      if (msg.type === 'SYNC_UPDATE') {
        setData(msg.payload);
      }
    });

    return () => port.disconnect();
  }, []);

  // Global Master Toggle handler
  const handleGlobalToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newState = e.target.checked;
    setIsEnabled(newState);
    chrome.storage.local.set({ extensionEnabled: newState });
  };
  
  const handleStyleChange = (fontSize: number, lyricColor: string) => {
    portRef.current?.postMessage({
      type: 'UPDATE_STYLE',
      payload: { fontSize, lyricColor }
    });
  };

  const handleReset = () => {
    portRef.current?.postMessage({ type: 'RESET_STYLES' });
  };

  const handleToggleCurrentDomain = () => {
    if (currentDomain !== null) {
      portRef.current?.postMessage({
        type: 'TOGGLE_DOMAIN_DISABLED',
        payload: { domain: currentDomain }
      });
    }
  };

  if (!data?.settings) {
    return <div style={{ padding: '16px', width: '220px', color: '#fff' }}>Loading...</div>;
  }

  const { fontSize, lyricColor, disabledDomains } = data.settings;
  const isDomainDisabled = currentDomain !== null && disabledDomains.includes(currentDomain);

  return (
    <div style={{ width: '280px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#1a1a1a', color: '#fff', fontFamily: 'sans-serif' }}>
      
      {/* Top Header & Site Toggle Option */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
        <span style={{ fontWeight: 'bold', fontSize: '15px' }}>🎵 LyricFlow</span>
        
        <button
          onClick={handleToggleCurrentDomain}
          style={{
            background: isDomainDisabled ? '#d9534f' : '#2e7d32',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '5px 9px',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 'bold',
            transition: 'background 0.2s'
          }}
          title="Enable/Disable overlay on this website domain"
        >
          {isDomainDisabled ? 'Disabled on Site' : 'Enabled on Site'}
        </button>
      </div>

      {/* Global Master On/Off Switch */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#252525', padding: '10px 12px', borderRadius: '6px', border: '1px solid #333' }}>
        <span style={{ fontSize: '13px', fontWeight: 'bold' }}> Extension toggle</span>
        <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', cursor: 'pointer' }}>
          <input 
            type="checkbox" 
            checked={isEnabled} 
            onChange={handleGlobalToggle}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span style={{
            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: isEnabled ? '#2e7d32' : '#555',
            transition: '.2s', borderRadius: '20px'
          }}>
            <span style={{
              position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
              backgroundColor: 'white', transition: '.2s', borderRadius: '50%',
              transform: isEnabled ? 'translateX(16px)' : 'translateX(0)'
            }} />
          </span>
        </label>
      </div>

      {/* Font Size Selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', opacity: isEnabled ? 1 : 0.4, pointerEvents: isEnabled ? 'auto' : 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#aaa' }}>
          <span>Font Size</span>
          <span style={{ color: '#fff', fontWeight: 'bold' }}>{fontSize}px</span>
        </div>
        <input 
          type="range" 
          min="12" 
          max="36" 
          value={fontSize} 
          onChange={(e) => handleStyleChange(Number(e.target.value), lyricColor)}
          style={{ width: '100%', cursor: 'pointer' }}
        />
      </div>

      {/* Curated High-Contrast Color Palette */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', opacity: isEnabled ? 1 : 0.4, pointerEvents: isEnabled ? 'auto' : 'none' }}>
        <span style={{ fontSize: '13px', color: '#aaa' }}>High-Visibility Lyric Colors</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
          {VISIBLE_COLOR_OPTIONS.map((c) => {
            const isSelected = lyricColor.toLowerCase() === c.hex.toLowerCase();
            return (
              <button
                key={c.hex}
                title={c.name}
                onClick={() => handleStyleChange(fontSize, c.hex)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: c.hex,
                  border: isSelected ? '3px solid #666' : '1px solid #444',
                  boxShadow: isSelected ? '0 0 6px rgba(255,255,255,0.8)' : 'none',
                  cursor: 'pointer',
                  transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                  transition: 'transform 0.1s, border 0.1s'
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Return to Default Button */}
      <button 
        onClick={handleReset}
        disabled={!isEnabled}
        style={{
          marginTop: '4px',
          padding: '8px',
          backgroundColor: '#333',
          color: '#ddd',
          border: '1px solid #444',
          borderRadius: '6px',
          cursor: isEnabled ? 'pointer' : 'not-allowed',
          fontSize: '12px',
          fontWeight: 'bold',
          opacity: isEnabled ? 1 : 0.4,
          transition: 'background 0.2s'
        }}
        onMouseOver={(e) => { if (isEnabled) e.currentTarget.style.backgroundColor = '#444'; }}
        onMouseOut={(e) => { if (isEnabled) e.currentTarget.style.backgroundColor = '#333'; }}
      >
        Return to Default Styles
      </button>
      <span style={{ fontSize: '14px', color: '#d8d8d8', marginTop: '4px' }}>Lyrics powered by LRCLIB.</span>
    </div>
  );
}

// --- React Mounting Logic ---
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}