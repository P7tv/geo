import React, { useEffect, useState } from 'react';

const AnimatedGauge = ({ value, size = 48, strokeWidth = 5 }) => {
  const [currentValue, setCurrentValue] = useState(0);
  
  useEffect(() => {
    // Animate from old value to new value
    setCurrentValue(value);
  }, [value]);

  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  // Use a semi-circle for the gauge (strokeDasharray: circumference / 2)
  const semiCircumference = circumference / 2;
  const strokeDashoffset = semiCircumference - (currentValue / 100) * semiCircumference;

  const getColor = (val) => {
    if (val >= 70) return 'var(--danger)';
    if (val >= 40) return 'var(--warn)';
    return 'var(--safe)';
  };

  const color = getColor(currentValue);

  return (
    <div style={{ position: 'relative', width: size, height: size / 2 + 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={size} height={size / 2} style={{ overflow: 'visible' }}>
        {/* Background track (semi-circle) */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Animated fill (semi-circle) */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${semiCircumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 1s ease-out, stroke 1s ease-out' }}
        />
      </svg>
      <div style={{ 
        position: 'absolute', 
        bottom: 4, 
        fontSize: size * 0.28, 
        fontFamily: 'var(--font-mono)', 
        fontWeight: 'bold', 
        color: 'var(--text-1)' 
      }}>
        {Math.round(currentValue)}
      </div>
    </div>
  );
};

export default AnimatedGauge;
