import { useMemo } from 'react';

// Generates a deterministic sparkline from currentLevel + situationLevel.
// No Math.random() — same inputs always produce the same shape.
const RiverSparkline = ({ currentLevel = 50, situationLevel = 1, color = 'var(--blue-primary)', width = 60, height = 20 }) => {
  const points = useMemo(() => {
    const pts = [];
    // Simulate 24-hour trend based on situation_level
    // 1=normal(flat/down), 2=watch(rising), 3=alert(sharply rising)
    const trend = situationLevel === 3 ? 3.5 : situationLevel === 2 ? 1.5 : -0.5;
    let lvl = Math.max(0, currentLevel - trend * 24 * 0.4);
    for (let i = 0; i <= 24; i++) {
      pts.push(i === 24 ? currentLevel : lvl);
      lvl = Math.min(100, Math.max(0, lvl + trend * 0.4));
    }

    const max = Math.max(...pts, 100);
    const min = Math.max(0, Math.min(...pts) - 5);
    const range = max - min || 1;

    return pts.map((p, i) => {
      const x = (i / 24) * width;
      const y = height - ((p - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }, [currentLevel, situationLevel, width, height]);

  const lastY = points.split(' ').pop().split(',')[1];

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={width} cy={lastY} r="2" fill={color} />
    </svg>
  );
};

export default RiverSparkline;
