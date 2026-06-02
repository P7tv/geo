import React, { useState, useEffect } from 'react';

const RiskTimeline = ({ route }) => {
  const [trendData, setTrendData] = useState([]);

  useEffect(() => {
    if (!route) return;
    const currentRisk = route.risk ?? 0;
    const rain = route.features?.f_forecast_rain ?? 0;
    let arr = [currentRisk];
    let r = currentRisk;
    for (let i = 1; i <= 6; i++) {
      // simulate drift based on rain intensity
      const drift = (rain * 20) - 4; // -4 to +16 drift per hour if rain is 1.0
      r = Math.min(100, Math.max(0, r + drift + (Math.random() * 4 - 2)));
      arr.push(r);
    }
    setTrendData(arr);
  }, [route]);

  if (!route || trendData.length === 0) return null;

  const hours = ['Now', '+1h', '+2h', '+3h', '+4h', '+5h', '+6h'];

  const width = 240;
  const height = 40;
  const padding = 6;
  const innerH = height - padding * 2;

  const getRiskColor = (val) => val >= 70 ? 'var(--danger)' : val >= 40 ? 'var(--warn)' : 'var(--safe)';
  const endColor = getRiskColor(trendData[6]);

  const points = trendData.map((val, i) => {
    const x = padding + (i / 6) * (width - padding * 2);
    const y = height - padding - (val / 100) * innerH;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="risk-timeline-container" style={{ marginTop: '10px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
        <span>แนวโน้มความเสี่ยง 6 ชม. (Predictive Timeline)</span>
        <span style={{ color: endColor, fontWeight: 'bold' }}>{Math.round(trendData[6])}% in 6h</span>
      </div>
      <svg 
        width="100%" 
        height={height} 
        viewBox={`0 0 ${width} ${height}`} 
        preserveAspectRatio="none" 
        style={{ background: 'var(--bg-surface)', borderRadius: '4px', border: '1px solid var(--border)' }}
      >
        {/* Background risk zones */}
        <rect x="0" y={height - padding - 0.4 * innerH} width={width} height={0.4 * innerH} fill="var(--safe-dim)" opacity="0.4" />
        <rect x="0" y={height - padding - 0.7 * innerH} width={width} height={0.3 * innerH} fill="var(--warn-dim)" opacity="0.4" />
        <rect x="0" y="0" width={width} height={height - padding - 0.7 * innerH} fill="var(--danger-dim)" opacity="0.4" />
        
        {/* Trend line */}
        <polyline 
          points={points} 
          fill="none" 
          stroke={endColor} 
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Data points */}
        {trendData.map((val, i) => {
          const x = padding + (i / 6) * (width - padding * 2);
          const y = height - padding - (val / 100) * innerH;
          return (
            <circle key={i} cx={x} cy={y} r="2.5" fill={getRiskColor(val)} stroke="#fff" strokeWidth="1" />
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8.5px', color: 'var(--text-3)', marginTop: '4px' }}>
        {hours.map((h, i) => <span key={i}>{h}</span>)}
      </div>
    </div>
  );
};

export default RiskTimeline;
