import React, { useState, useEffect } from 'react';

const HIST = [
  { id: '1day',   label: '1d' },
  { id: '3days',  label: '3d' },
  { id: '7days',  label: '7d' },
  { id: '30days', label: '30d' },
];
const PRED = [
  { id: 0, label: 'Now' },
  { id: 1, label: '+6h' },
  { id: 2, label: '+12h' },
  { id: 3, label: '+24h' },
  { id: 4, label: '+72h' },
];

export default function FloodAnimationControl({
  floodRange, setFloodRange, isFloodLayerActive,
  simulationRainMultiplier = 1.0,
  predictiveMode, setPredictiveMode,
  predictiveStep, setPredictiveStep,
}) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || predictiveMode) return;
    const t = setInterval(() => setFloodRange(c => {
      const i = HIST.findIndex(h => h.id === c);
      return HIST[(i + 1) % HIST.length].id;
    }), 1500);
    return () => clearInterval(t);
  }, [playing, predictiveMode, setFloodRange]);

  useEffect(() => {
    if (!playing || !predictiveMode) return;
    const t = setInterval(() => setPredictiveStep(s => {
      if (s >= PRED.length - 1) { setPlaying(false); return s; }
      return s + 1;
    }), 1200);
    return () => clearInterval(t);
  }, [playing, predictiveMode, setPredictiveStep]);

  if (!isFloodLayerActive) return null;

  const accent = predictiveMode ? '#f59e0b' : '#3b82f6';
  const steps  = predictiveMode ? PRED : HIST;
  const active = predictiveMode ? predictiveStep : floodRange;

  const btn = (id, label, onClick) => {
    const sel = active === id;
    return (
      <button key={id} onClick={onClick} style={{
        padding: '1px 6px', borderRadius: 99, border: 'none',
        fontSize: 8, fontWeight: sel ? 700 : 400, cursor: 'pointer',
        background: sel ? accent : 'transparent',
        color: sel ? (predictiveMode ? '#0f172a' : '#fff') : 'rgba(255,255,255,0.4)',
        transition: 'all 0.15s',
      }}>{label}</button>
    );
  };

  return (
    <div className="flood-animation-control" style={{
      position: 'absolute', bottom: 12, left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(10px)',
      border: `1px solid ${accent}33`, borderRadius: 99,
      padding: '3px 8px', display: 'inline-flex', alignItems: 'center',
      gap: 4, zIndex: 1000, boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
      whiteSpace: 'nowrap', userSelect: 'none',
    }}>
      {/* play */}
      <button onClick={() => setPlaying(p => !p)} style={{
        width: 20, height: 20, borderRadius: '50%', border: 'none',
        background: playing ? 'rgba(239,68,68,0.2)' : accent,
        color: playing ? '#ef4444' : '#fff',
        fontSize: 9, cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{playing ? '⏸' : '▶'}</button>

      {/* mode label */}
      <span style={{ fontSize: 8, fontWeight: 700, color: accent }}>
        {predictiveMode ? '🔮' : '🕐'}
      </span>

      <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.1)' }} />

      {/* time steps */}
      {steps.map(s => btn(s.id, s.label, () => {
        setPlaying(false);
        predictiveMode ? setPredictiveStep(s.id) : setFloodRange(s.id);
      }))}

      <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.1)' }} />

      {/* mode toggle */}
      {[{ id: false, label: 'ประวัติ' }, { id: true, label: 'ทำนาย' }].map(m => (
        <button key={String(m.id)} onClick={() => { setPredictiveMode(m.id); setPlaying(false); }} style={{
          padding: '1px 6px', borderRadius: 99, border: 'none', fontSize: 8,
          fontWeight: predictiveMode === m.id ? 700 : 400, cursor: 'pointer',
          background: predictiveMode === m.id ? (m.id ? '#f59e0b' : '#3b82f6') : 'transparent',
          color: predictiveMode === m.id ? '#0f172a' : 'rgba(255,255,255,0.35)',
          transition: 'all 0.15s',
        }}>{m.label}</button>
      ))}
    </div>
  );
}
