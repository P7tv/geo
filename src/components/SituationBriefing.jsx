import { useState } from 'react';

export default function SituationBriefing({ briefing, alertLevel, timestamp, onRefresh, isLoading }) {
  const [collapsed, setCollapsed] = useState(false);

  const getAlertConfig = (level) => {
    if (level === 3) {
      return {
        bg: 'rgba(255, 59, 48, 0.12)',
        border: '1px solid rgba(255, 59, 48, 0.3)',
        borderLeft: '4px solid var(--critical-red)',
        color: '#ffdddd',
        badge: 'CRITICAL ALERT LV.3',
        badgeColor: 'var(--critical-red)'
      };
    }
    if (level === 2) {
      return {
        bg: 'rgba(255, 159, 0, 0.12)',
        border: '1px solid rgba(255, 159, 0, 0.3)',
        borderLeft: '4px solid var(--hazard-amber)',
        color: '#ffeedd',
        badge: 'WARNING ALERT LV.2',
        badgeColor: 'var(--hazard-amber)'
      };
    }
    return {
      bg: 'rgba(0, 229, 255, 0.1)',
      border: '1px solid rgba(0, 229, 255, 0.2)',
      borderLeft: '4px solid var(--cyber-blue)',
      color: '#e0fcfd',
      badge: 'NORMAL SITUATION LV.1',
      badgeColor: 'var(--cyber-blue)'
    };
  };

  const config = getAlertConfig(alertLevel);
  const formattedTime = timestamp ? new Date(timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';

  return (
    <div style={{
      margin: '12px 16px 0 16px',
      borderRadius: '10px',
      background: config.bg,
      border: config.border,
      borderLeft: config.borderLeft,
      color: config.color,
      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 18px',
        cursor: 'pointer',
        userSelect: 'none'
      }} onClick={() => setCollapsed(!collapsed)}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ 
            fontSize: '12px',
            animation: 'alarm-pulse 1s infinite alternate',
            display: 'inline-block'
          }}>
            {alertLevel === 3 ? '🔴' : alertLevel === 2 ? '🟡' : '🔵'}
          </span>
          <strong style={{ 
            fontSize: '12px', 
            letterSpacing: '1.2px', 
            color: config.badgeColor,
            fontFamily: 'Outfit',
            fontWeight: 900
          }}>
            {config.badge}
          </strong>
          <span style={{ 
            fontSize: '9px', 
            background: 'rgba(255,255,255,0.06)', 
            border: '1px solid var(--line-glass)',
            padding: '2px 8px', 
            borderRadius: '20px',
            opacity: 0.9,
            fontFamily: 'IBM Plex Mono',
            fontWeight: 600,
            color: '#fff'
          }}>
            SPHERE REAL-TIME CONTEXT SUMMARY
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }} onClick={e => e.stopPropagation()}>
          <span className="mono" style={{ fontSize: '10px', opacity: 0.7 }}>
            วิเคราะห์ล่าสุด: {formattedTime} น.
          </span>
          <button 
            onClick={onRefresh} 
            disabled={isLoading}
            style={{
              background: 'var(--cyber-blue-dim)',
              border: '1px solid var(--cyber-blue)',
              color: 'var(--cyber-blue)',
              borderRadius: '4px',
              padding: '4px 10px',
              fontSize: '10px',
              fontFamily: 'Outfit',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            {isLoading ? '⟳ LOADING...' : '⟳ REFRESH BRIEFING'}
          </button>
          <span style={{ 
            fontSize: '10px', 
            opacity: 0.6, 
            cursor: 'pointer',
            padding: '0 4px',
            fontWeight: 'bold'
          }} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '▼ EXPAND' : '▲ COLLAPSE'}
          </span>
        </div>

      </div>

      {!collapsed && (
        <div style={{
          padding: '4px 18px 14px 44px',
          fontSize: '12.5px',
          lineHeight: '1.65',
          borderTop: '1px solid var(--line-glass)',
          fontFamily: 'Outfit',
          fontWeight: 400,
          opacity: 0.95
        }}>
          {briefing || 'กำลังดึงรายงานวิเคราะห์สถานการณ์เร่งด่วนจากหน่วยวิเคราะห์ปัญญาประดิษฐ์...'}
        </div>
      )}
    </div>
  );
}
