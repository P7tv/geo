import React from 'react';

const WaterfallChart = ({ route }) => {
  if (!route) return null;
  
  const riskPct = route.risk ?? 0;
  const ft = route.features ?? {};
  
  // Example hardcoded weights that conceptually add up to the risk
  // Normally this would come from a backend SHAP values or true linear weights.
  // For demo, we just proportionally break down the risk.
  
  const floodExp = Math.round((ft.f_flood_exposure ?? 0) * 100);
  const rain = Math.round((ft.f_forecast_rain ?? 0) * 100);
  const history = Math.round((ft.f_historical ?? 0) * 100);
  const soil = Math.round((ft.f_soil ?? 0) * 100);
  
  // Fake weighting to make the sum equal `riskPct`
  const sumRaw = floodExp * 0.45 + rain * 0.25 + history * 0.20 + soil * 0.10;
  const scale = sumRaw > 0 ? riskPct / sumRaw : 0;
  
  const items = [
    { label: 'น้ำท่วมปัจจุบัน', value: floodExp * 0.45 * scale, color: 'var(--danger)' },
    { label: 'ฝนคาดการณ์', value: rain * 0.25 * scale, color: 'var(--blue-primary)' },
    { label: 'ประวัติเก่า', value: history * 0.20 * scale, color: 'var(--warn)' },
    { label: 'ความเสี่ยงดิน', value: soil * 0.10 * scale, color: 'var(--safe)' }
  ];

  let cumulative = 0;

  return (
    <div className="waterfall-container">
      <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px', textAlign: 'center' }}>
        XAI: ที่มาของคะแนนความเสี่ยง {riskPct}%
      </div>
      {items.map((item, idx) => {
        const val = Math.round(item.value);
        if (val === 0) return null;
        
        const start = cumulative;
        cumulative += val;
        
        return (
          <div key={idx} className="waterfall-row">
            <div className="waterfall-label">{item.label}</div>
            <div className="waterfall-track">
              {idx > 0 && <div className="waterfall-connector" style={{ left: `${start}%` }} />}
              <div 
                className="waterfall-bar" 
                style={{ 
                  left: `${start}%`, 
                  width: `${val}%`, 
                  background: item.color,
                  minWidth: '20px' // ensure text fits
                }}
              >
                +{val}%
              </div>
            </div>
          </div>
        );
      })}
      
      {/* Total row */}
      <div className="waterfall-row" style={{ marginTop: '4px', borderTop: '1px solid var(--border)', paddingTop: '4px' }}>
        <div className="waterfall-label" style={{ fontWeight: 'bold', color: 'var(--text-1)' }}>รวมความเสี่ยง</div>
        <div className="waterfall-track">
          <div 
            className="waterfall-bar" 
            style={{ 
              left: `0%`, 
              width: `${riskPct}%`, 
              background: riskPct >= 70 ? 'var(--danger)' : riskPct >= 40 ? 'var(--warn)' : 'var(--safe)',
              textAlign: 'right',
              justifyContent: 'flex-end',
              paddingRight: '4px'
            }}
          >
            {riskPct}%
          </div>
        </div>
      </div>
    </div>
  );
};

export default WaterfallChart;
