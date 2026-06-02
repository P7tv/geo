import React from 'react';

const RadarChart = ({ routes }) => {
  const size = 200;
  const center = size / 2;
  const radius = size / 2 - 20;
  
  // 4 Risk Factors
  const labels = ['พื้นที่น้ำท่วม', 'ฝนคาดการณ์', 'ประวัติน้ำท่วม', 'ความเสี่ยงดิน'];
  const numAxis = labels.length;
  const angleStep = (Math.PI * 2) / numAxis;

  // Helpers
  const getPoint = (val, i) => {
    // val is 0-100
    const r = (val / 100) * radius;
    const angle = i * angleStep - Math.PI / 2; // Start at top
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle)
    };
  };

  const colors = {
    A: '#22c55e', // safe
    B: '#f59e0b', // warn
    C: '#ef4444'  // danger
  };

  return (
    <div className="radar-chart-container" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Draw background grid (circles) */}
        {[20, 40, 60, 80, 100].map(level => {
          const r = (level / 100) * radius;
          return (
            <circle 
              key={level} 
              cx={center} 
              cy={center} 
              r={r} 
              fill="none" 
              stroke="var(--border-strong)" 
              strokeDasharray={level === 100 ? "" : "2,2"} 
              strokeWidth={level === 100 ? 1 : 0.5} 
            />
          );
        })}
        
        {/* Draw axes */}
        {labels.map((label, i) => {
          const p = getPoint(100, i);
          const textP = getPoint(115, i); // Text slightly further out
          return (
            <g key={label}>
              <line x1={center} y1={center} x2={p.x} y2={p.y} stroke="var(--border-strong)" strokeWidth="1" />
              <text 
                x={textP.x} 
                y={textP.y} 
                fontSize="9" 
                fill="var(--text-2)" 
                textAnchor="middle" 
                alignmentBaseline="middle"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Draw polygons for each route */}
        {routes.map(route => {
          const ft = route.features || {};
          const vals = [
            (ft.f_flood_exposure || 0) * 100,
            (ft.f_forecast_rain || 0) * 100,
            (ft.f_historical || 0) * 100,
            (ft.f_soil || 0) * 100
          ];
          
          const pointsStr = vals.map((val, i) => {
            const p = getPoint(Math.min(val, 100), i);
            return `${p.x},${p.y}`;
          }).join(' ');
          
          const color = colors[route.id] || '#3b82f6';

          return (
            <polygon 
              key={route.id}
              points={pointsStr} 
              fill={color} 
              fillOpacity="0.2" 
              stroke={color} 
              strokeWidth="2" 
            />
          );
        })}
      </svg>

      <div className="radar-legend">
        {routes.map(route => {
          const color = colors[route.id] || '#3b82f6';
          return (
            <div key={route.id} className="radar-legend-item">
              <div className="radar-legend-color" style={{ backgroundColor: color }}></div>
              <span>{route.name || `Route ${route.id}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RadarChart;
