import React from 'react';

export default function VehicleStatsPanel({ vehicleData }) {
  const getProgressBlocks = (count, level) => {
    const blocksCount = Math.min(5, Math.ceil(count / 12));
    const fillBlock = "█";
    const emptyBlock = "░";
    
    const color = level === 'blocked' ? 'var(--critical-red)' : level === 'warning' ? 'var(--hazard-amber)' : 'var(--neon-emerald)';
    
    return (
      <span style={{ color }}>
        {fillBlock.repeat(blocksCount)}
        <span style={{ opacity: 0.2 }}>{emptyBlock.repeat(5 - blocksCount)}</span>
      </span>
    );
  };

  const getAlertIcon = (level) => {
    if (level === 'blocked') {
      return (
        <span style={{ 
          background: 'rgba(255, 59, 48, 0.1)', 
          border: '1px solid rgba(255, 59, 48, 0.3)', 
          color: 'var(--critical-red)', 
          padding: '2px 6px', 
          borderRadius: '4px',
          fontWeight: 'bold',
          fontSize: '9px'
        }}>🚫 BLOCKED</span>
      );
    }
    if (level === 'warning') {
      return (
        <span style={{ 
          background: 'rgba(255, 179, 0, 0.1)', 
          border: '1px solid rgba(255, 179, 0, 0.3)', 
          color: 'var(--hazard-amber)', 
          padding: '2px 6px', 
          borderRadius: '4px',
          fontWeight: 'bold',
          fontSize: '9px'
        }}>⚠️ WARNING</span>
      );
    }
    return (
      <span style={{ 
        background: 'rgba(0, 212, 170, 0.1)', 
        border: '1px solid rgba(0, 212, 170, 0.3)', 
        color: 'var(--neon-emerald)', 
        padding: '2px 6px', 
        borderRadius: '4px',
        fontWeight: 'bold',
        fontSize: '9px'
      }}>✓ NORMAL</span>
    );
  };

  const routeNames = {
    A: 'เส้นทาง A - ทล.1 (กล้อง cam_01, cam_02)',
    B: 'เส้นทาง B - ทล.118 (กล้อง cam_03)',
    C: 'เส้นทาง C - ทางลัดสันทราย (กล้อง cam_04)'
  };

  return (
    <div className="sidebar-section">
      <div className="section-title"><h2>LIVE CCTV TRAFFIC FLOW</h2></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
        {['A', 'B', 'C'].map(id => {
          const data = vehicleData[id] || { vehicle_count: 0, avg_speed: 0, congestion_level: 'normal' };
          
          return (
            <div key={id} style={{ 
              background: 'rgba(2, 5, 11, 0.6)', 
              border: '1px solid var(--line-glass)', 
              borderRadius: '8px', 
              padding: '12px' 
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 'bold', marginBottom: '8px', fontFamily: 'Outfit' }}>
                <span style={{ color: '#fff' }}>{routeNames[id]}</span>
                <span className="mono">{getAlertIcon(data.congestion_level)}</span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: '13px', letterSpacing: '2px' }}>
                  {getProgressBlocks(data.vehicle_count, data.congestion_level)}
                </div>
                <div className="mono" style={{ fontSize: '10.5px', color: '#8b949e' }}>
                  <strong style={{ color: '#fff' }}>{data.vehicle_count}</strong> คัน · <strong style={{ color: '#fff' }}>{data.avg_speed}</strong> กม/ชม
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
