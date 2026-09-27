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

  const [fallbackSettings, setFallbackSettings] = useState({
    fontSize: 18,
    lyricColor: '#1DB954',
    disabledDomains: [] as string[]
  });

  useEffect(() => {
    chrome.storage.local.get(['extensionEnabled', 'fontSize', 'lyricColor', 'disabledDomains'], (result) => {
      if (result.extensionEnabled !== undefined) {
        setIsEnabled(result.extensionEnabled);
      }
      setFallbackSettings({
        fontSize: result.fontSize || 18,
        lyricColor: result.lyricColor || '#1DB954',
        disabledDomains: result.disabledDomains || []
      });
    });

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
        if (msg.payload?.settings) {
          setFallbackSettings(msg.payload.settings);
        }
      }
    });

    return () => port.disconnect();
  }, []);

  const handleGlobalToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newState = e.target.checked;
    setIsEnabled(newState);
    chrome.storage.local.set({ extensionEnabled: newState });
  };
  
  const handleStyleChange = (fontSize: number, lyricColor: string) => {
    setFallbackSettings(prev => ({ ...prev, fontSize, lyricColor }));
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

  const settings = data?.settings || fallbackSettings;
  const { fontSize, lyricColor, disabledDomains } = settings;
  const isDomainDisabled = currentDomain !== null && disabledDomains.includes(currentDomain);

  return (
    <div style={{ 
      width: '300px', 
      padding: '20px', 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '16px', 
      background: '#121212', 
      color: '#fff', 
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' 
    }}>
      {/* INJECTED CSS FOR CUSTOM SLIDER */}
      <style>{`
        input[type=range] {
          -webkit-appearance: none;
          width: 100%;
          background: transparent;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #fff;
          cursor: pointer;
          margin-top: -5px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.5);
          transition: transform 0.1s;
        }
        input[type=range]::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        input[type=range]::-webkit-slider-runnable-track {
          width: 100%;
          height: 6px;
          cursor: pointer;
          background: #333;
          border-radius: 3px;
          transition: background 0.2s;
        }
        input[type=range]:focus {
          outline: none;
        }
        input[type=range]:hover::-webkit-slider-runnable-track {
          background: #444;
        }
      `}</style>

      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>🎵</span>
          <span style={{ fontWeight: '700', fontSize: '16px', letterSpacing: '0.3px' }}>LyricFlow</span>
        </div>
      </div>

      {/* CARD 1: Power & Site Status */}
      <div style={{ background: '#1e1e1e', borderRadius: '12px', padding: '14px', border: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        
        {/* Global Master On/Off Switch */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', fontWeight: '500' }}>Extension Power</span>
          <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={isEnabled} 
              onChange={handleGlobalToggle}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span style={{
              position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: isEnabled ? '#1DB954' : '#444', /* Spotify Green accent */
              transition: '.2s', borderRadius: '22px'
            }}>
              <span style={{
                position: 'absolute', content: '""', height: '16px', width: '16px', left: '3px', bottom: '3px',
                backgroundColor: 'white', transition: '.2s', borderRadius: '50%',
                transform: isEnabled ? 'translateX(18px)' : 'translateX(0)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
              }} />
            </span>
          </label>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #2a2a2a', margin: '0' }} />

        {/* Site Toggle Option */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#aaa' }}>Current Tab</span>
          <button
            onClick={handleToggleCurrentDomain}
            style={{
              background: isDomainDisabled ? 'rgba(217, 83, 79, 0.15)' : 'rgba(29, 185, 84, 0.15)',
              color: isDomainDisabled ? '#ff6b6b' : '#1DB954',
              border: `1px solid ${isDomainDisabled ? 'rgba(217, 83, 79, 0.3)' : 'rgba(29, 185, 84, 0.3)'}`,
              borderRadius: '20px',
              padding: '6px 12px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: '600',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.2)'}
            onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
            title="Enable/Disable overlay on this website domain"
          >
            {isDomainDisabled ? 'Disabled on Site' : 'Enabled on Site'}
          </button>
        </div>
      </div>

      {/* CARD 2: Appearance Settings */}
      <div style={{ 
        background: '#1e1e1e', borderRadius: '12px', padding: '16px', border: '1px solid #2a2a2a',
        display: 'flex', flexDirection: 'column', gap: '20px',
        opacity: isEnabled ? 1 : 0.4, pointerEvents: isEnabled ? 'auto' : 'none',
        transition: 'opacity 0.2s'
      }}>
        
        {/* Font Size Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: '#aaa', fontWeight: '500' }}>Font Size</span>
            <span style={{ color: '#fff', fontWeight: '700' }}>{fontSize}px</span>
          </div>
          <input 
            type="range" 
            min="12" 
            max="36" 
            value={fontSize} 
            onChange={(e) => handleStyleChange(Number(e.target.value), lyricColor)}
          />
        </div>

        {/* Curated High-Contrast Color Palette */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span style={{ fontSize: '13px', color: '#aaa', fontWeight: '500' }}>Lyric Color</span>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
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
                    border: 'none',
                    boxShadow: isSelected 
                      ? `0 0 0 2px #1e1e1e, 0 0 0 4px ${c.hex}` 
                      : '0 2px 4px rgba(0,0,0,0.2)',
                    cursor: 'pointer',
                    transform: isSelected ? 'scale(1)' : 'scale(0.9)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseOver={(e) => { if (!isSelected) e.currentTarget.style.transform = 'scale(1)'; }}
                  onMouseOut={(e) => { if (!isSelected) e.currentTarget.style.transform = 'scale(0.9)'; }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Area */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
        <button 
          onClick={handleReset}
          disabled={!isEnabled}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: 'transparent',
            color: '#aaa',
            border: '1px solid #333',
            borderRadius: '20px',
            cursor: isEnabled ? 'pointer' : 'not-allowed',
            fontSize: '13px',
            fontWeight: '600',
            opacity: isEnabled ? 1 : 0.4,
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => { if (isEnabled) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.border = '1px solid #555'; } }}
          onMouseOut={(e) => { if (isEnabled) { e.currentTarget.style.color = '#aaa'; e.currentTarget.style.border = '1px solid #333'; } }}
        >
          Reset to Defaults
        </button>
        <span style={{ fontSize: '12px', color: '#666', fontWeight: '500' }}>Lyrics powered by LRCLIB</span>
      </div>
      
    </div>
  );
}

// --- React Mounting Logic ---
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}