import React, { useState } from 'react';
import { Play, Settings, AlertTriangle, Info, CloudRain, Droplets, ShieldAlert } from 'lucide-react';

const PRESETS = {
  normal: { name: 'ปกติ', rain: 0, days: 1, river: 'normal' },
  storm: { name: 'พายุฤดูร้อน', rain: 80, days: 2, river: 'warning' },
  flood2011: { name: 'น้ำท่วมใหญ่ 2554', rain: 120, days: 5, river: 'critical' },
  maesai2024: { name: 'วิกฤตแม่สาย 2567', rain: 200, days: 3, river: 'critical' }
};

export default function SimulationPanel({ onSimulate, isSimulating, results }) {
  const [rain, setRain] = useState(0);
  const [days, setDays] = useState(1);
  const [river, setRiver] = useState('normal');

  const handlePreset = (presetKey) => {
    const p = PRESETS[presetKey];
    setRain(p.rain);
    setDays(p.days);
    setRiver(p.river);
  };

  const handleSimulate = () => {
    onSimulate({ rain_mm_per_day: rain, duration_days: days, river_level: river });
  };

  return (
    <div className="sandbox-simulation-panel" style={{
      background: 'var(--bg-panel)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '16px',
      color: 'var(--text-1)',
      width: '100%',
      boxShadow: 'var(--shadow-sm)',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      marginBottom: '16px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
        <Settings size={18} color="var(--blue-glow)" />
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>Sandbox Settings</h3>
      </div>

      {/* Presets */}
      <div>
        <div style={{ fontSize: '11px', color: 'var(--text-2)', marginBottom: '8px', fontWeight: 600 }}>สถานการณ์สำเร็จรูป (Presets):</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} onClick={() => handlePreset(k)} style={{
              background: 'var(--bg-2)', border: '1px solid var(--border)',
              color: 'var(--text-1)', padding: '4px 10px', borderRadius: '100px',
              fontSize: '11px', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 500
            }} onMouseOver={e => e.target.style.background = 'var(--blue-primary)'} onMouseOut={e => e.target.style.background = 'var(--bg-2)'}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--bg-2)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
        {/* Rain */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-2)' }}><CloudRain size={12}/> ปริมาณฝน (mm/day)</span>
            <span style={{ fontWeight: 'bold', color: 'var(--blue-glow)' }}>{rain} mm</span>
          </div>
          <input type="range" min="0" max="250" step="10" value={rain} onChange={e => setRain(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--blue-glow)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-3)' }}>
            <span>ไม่มีฝน</span><span>พายุหนัก</span>
          </div>
        </div>

        {/* Duration */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-2)' }}><Info size={12}/> ระยะเวลาฝนตกต่อเนื่อง</span>
            <span style={{ fontWeight: 'bold' }}>{days} วัน</span>
          </div>
          <input type="range" min="1" max="7" step="1" value={days} onChange={e => setDays(Number(e.target.value))} style={{ width: '100%' }} />
        </div>

        {/* River */}
        <div>
          <div style={{ fontSize: '11px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-2)' }}><Droplets size={12}/> ระดับน้ำแม่น้ำหลัก</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {['normal', 'warning', 'critical'].map(lvl => (
              <button key={lvl} onClick={() => setRiver(lvl)} style={{
                flex: 1, padding: '6px 0', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', fontWeight: 600,
                background: river === lvl ? (lvl === 'critical' ? 'rgba(239, 68, 68, 0.15)' : lvl === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(59, 130, 246, 0.15)') : 'var(--bg-panel)',
                border: `1px solid ${river === lvl ? (lvl === 'critical' ? '#ef4444' : lvl === 'warning' ? '#f59e0b' : '#3b82f6') : 'var(--border)'}`,
                color: river === lvl ? (lvl === 'critical' ? '#ef4444' : lvl === 'warning' ? '#f59e0b' : '#3b82f6') : 'var(--text-2)'
              }}>
                {lvl === 'normal' ? 'ปกติ' : lvl === 'warning' ? 'เฝ้าระวัง' : 'วิกฤต'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button 
        onClick={handleSimulate}
        disabled={isSimulating}
        style={{
          background: 'var(--blue-primary)', color: '#fff', border: 'none',
          padding: '10px', borderRadius: 'var(--radius-md)', fontWeight: 'bold', fontSize: '12px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          cursor: isSimulating ? 'wait' : 'pointer', opacity: isSimulating ? 0.7 : 1,
          marginTop: '4px', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
        }}
      >
        <Play size={14} fill="#fff" />
        {isSimulating ? 'กำลังประมวลผล B200...' : 'Run Simulation'}
      </button>

      {/* Results */}
      {results && (
        <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: '1px dashed var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldAlert size={14} color={results.recommendation.includes('วิกฤต') ? 'var(--danger)' : results.recommendation.includes('ระวัง') ? 'var(--warn)' : 'var(--safe)'} />
            AI Recommendation
          </div>
          <div style={{ 
            background: results.recommendation.includes('วิกฤต') ? 'rgba(239, 68, 68, 0.1)' : results.recommendation.includes('ระวัง') ? 'rgba(245, 158, 11, 0.1)' : 'rgba(34, 197, 94, 0.1)',
            borderLeft: `3px solid ${results.recommendation.includes('วิกฤต') ? '#ef4444' : results.recommendation.includes('ระวัง') ? '#f59e0b' : '#22c55e'}`,
            padding: '10px', borderRadius: '4px', fontSize: '11px', lineHeight: 1.5,
            color: 'var(--text-1)'
          }}>
            {results.recommendation}
          </div>
        </div>
      )}
    </div>
  );
}
