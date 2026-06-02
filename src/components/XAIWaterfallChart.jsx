import React from 'react';

const XAIWaterfallChart = ({ route }) => {
  if (!route) return null;

  const ft = route.features || {};
  const shap = route.shap_explanation;
  
  // Use real SHAP values from ML if available, otherwise use rule-based fallback
  const factors = shap ? [
    { name: 'พื้นที่เสี่ยงน้ำท่วม', value: Math.round(shap.f_flood_exposure || 0), color: '#3b82f6' },
    { name: 'ฝนคาดการณ์', value: Math.round(shap.f_forecast_rain || 0), color: '#8b5cf6' },
    { name: 'ประวัติน้ำท่วมซ้ำซาก', value: Math.round(shap.f_historical_freq || 0), color: '#f59e0b' },
    { name: 'ลักษณะดินอุ้มน้ำ', value: Math.round(shap.f_soil_moisture || 0), color: '#84cc16' }
  ] : [
    { name: 'พื้นที่เสี่ยงน้ำท่วม', value: Math.round((ft.f_flood_exposure || 0) * 100 * 0.45), color: '#3b82f6' },
    { name: 'ฝนคาดการณ์', value: Math.round((ft.f_forecast_rain || 0) * 100 * 0.25), color: '#8b5cf6' },
    { name: 'ประวัติน้ำท่วมซ้ำซาก', value: Math.round((ft.f_historical || 0) * 100 * 0.20), color: '#f59e0b' },
    { name: 'ลักษณะดินอุ้มน้ำ', value: Math.round((ft.f_soil || 0) * 100 * 0.10), color: '#84cc16' }
  ];

  let cumulative = 0;
  const bars = factors.map(factor => {
    const start = cumulative;
    const absVal = Math.abs(factor.value); // SHAP can be negative theoretically, but we visualize contribution magnitude
    cumulative += absVal;
    return { ...factor, start, end: cumulative, displayValue: factor.value };
  });

  const totalRisk = Math.round(route.risk);

  return (
    <div style={{ marginTop: 12, marginBottom: 8, fontFamily: 'var(--font-th)' }}>
      <div style={{ 
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 
      }}>
        <div style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--blue-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          🤖 XAI Risk Breakdown
        </div>
        <div style={{ fontSize: 16, fontWeight: 'bold', color: totalRisk >= 70 ? 'var(--danger)' : totalRisk >= 40 ? 'var(--warn)' : 'var(--safe)' }}>
          {totalRisk}%
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bars.map((bar, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', fontSize: 11 }}>
            <div style={{ width: 100, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {bar.name}
            </div>
            <div style={{ flex: 1, height: 16, background: 'rgba(255,255,255,0.05)', borderRadius: 4, position: 'relative', margin: '0 8px' }}>
              {bar.value > 0 && (
                <div style={{
                  position: 'absolute',
                  left: `${bar.start}%`,
                  width: `${Math.max(bar.value, 1)}%`,
                  height: '100%',
                  background: bar.color,
                  borderRadius: 3,
                  boxShadow: `0 0 8px ${bar.color}40`,
                  transition: 'all 0.3s ease'
                }} />
              )}
            </div>
            <div style={{ width: 30, textAlign: 'right', fontWeight: 'bold', color: bar.color }}>
              +{bar.value}
            </div>
          </div>
        ))}
      </div>
      
      <div style={{ marginTop: 12, padding: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
        คะแนนความเสี่ยงประเมินโดยโมเดลจาก 4 ปัจจัยหลัก หากเกิน 40% ควรพิจารณาใช้รถยกสูง หากเกิน 70% ให้หลีกเลี่ยงเส้นทาง
      </div>
    </div>
  );
};

export default XAIWaterfallChart;
