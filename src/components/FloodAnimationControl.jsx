import React, { useState, useEffect } from 'react';

const FLOOD_STAGES = ['1day', '3days', '7days', '30days'];
const STAGE_LABELS = {
  '1day': 'Day 1',
  '3days': 'Day 3',
  '7days': 'Day 7',
  '30days': 'Day 30'
};

export default function FloodAnimationControl({ floodRange, setFloodRange, isFloodLayerActive }) {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let timer;
    if (isPlaying) {
      timer = setInterval(() => {
        setFloodRange(current => {
          const currentIndex = FLOOD_STAGES.indexOf(current);
          if (currentIndex === -1 || currentIndex === FLOOD_STAGES.length - 1) {
            return FLOOD_STAGES[0]; // loop back
          }
          return FLOOD_STAGES[currentIndex + 1];
        });
      }, 1500); // 1.5 seconds per frame
    }
    return () => clearInterval(timer);
  }, [isPlaying, setFloodRange]);

  if (!isFloodLayerActive) return null;

  return (
    <div className="flood-animation-control" style={{
      position: 'absolute',
      bottom: 24,
      right: 180, // Next to the map legend
      background: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(8px)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '12px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      zIndex: 1000,
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      color: 'var(--text-1)',
      fontFamily: 'var(--font-en)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button 
          onClick={() => setIsPlaying(!isPlaying)}
          style={{
            background: isPlaying ? 'rgba(239, 68, 68, 0.2)' : 'var(--blue-primary)',
            color: isPlaying ? '#ef4444' : '#fff',
            border: isPlaying ? '1px solid rgba(239, 68, 68, 0.4)' : 'none',
            width: 36, height: 36, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 16,
            transition: 'all 0.2s',
            boxShadow: isPlaying ? 'none' : '0 4px 12px rgba(59, 130, 246, 0.4)'
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <div>
          <div style={{ fontSize: 11, color: 'var(--blue-primary)', fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase' }}>
            Flood Propagation
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>Time-lapse Simulation</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {FLOOD_STAGES.map((stage, idx) => (
          <React.Fragment key={stage}>
            <button
              onClick={() => { setIsPlaying(false); setFloodRange(stage); }}
              style={{
                background: floodRange === stage ? 'var(--blue-primary)' : 'rgba(51, 65, 85, 0.5)',
                color: floodRange === stage ? '#fff' : 'var(--text-2)',
                border: '1px solid',
                borderColor: floodRange === stage ? 'var(--blue-glow)' : 'var(--border)',
                padding: '4px 10px',
                borderRadius: 16,
                fontSize: 11,
                fontWeight: floodRange === stage ? 'bold' : 'normal',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: floodRange === stage ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none'
              }}
            >
              {STAGE_LABELS[stage]}
            </button>
            {idx < FLOOD_STAGES.length - 1 && (
              <div style={{ width: 12, height: 1, background: 'var(--border-strong)' }} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
