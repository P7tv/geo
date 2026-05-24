/**
 * Renders circular floating traffic status badges in the middle coordinates of route polylines
 * Using GISTDA Sphere Map JS API
 */
export const renderVehicleTrafficBadges = (mapInstance, routePaths, vehicleData, activeRoute) => {
  if (!window.sphere) return [];
  const markers = [];

  Object.entries(routePaths).forEach(([routeId, pathData]) => {
    if (!pathData || !pathData.points || pathData.points.length === 0) return;

    const points = pathData.points;
    const midIndex = Math.floor(points.length / 2);
    const midPoint = points[midIndex];

    if (midPoint && mapInstance) {
      const data = vehicleData[routeId] || { vehicle_count: 0, avg_speed: 0, congestion_level: 'normal' };
      
      const isBlocked = data.congestion_level === 'blocked';
      const isWarning = data.congestion_level === 'warning';
      
      const color = isBlocked ? 'var(--critical-red)' : isWarning ? 'var(--hazard-amber)' : 'var(--neon-emerald)';
      const emoji = isBlocked ? '🚫' : isWarning ? '⚠️' : '🚗';
      
      const html = `<div style="
        background: rgba(11, 15, 25, 0.95);
        border: 1px solid ${color}55;
        border-left: 3px solid ${color};
        padding: 4px 8px;
        border-radius: 4px;
        color: #fff;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 5px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        white-space: nowrap;
        pointer-events: auto;
      ">${emoji} ${data.vehicle_count || 0} คัน (${data.avg_speed || 0} กม/ชม)</div>`;

      // Create Sphere Marker with Custom HTML
      const marker = new window.sphere.Marker(
        { lon: midPoint.lon, lat: midPoint.lat },
        {
          title: `จราจร ${routeId}`,
          icon: { html }
        }
      );

      mapInstance.Overlays.add(marker);
      markers.push(marker);
    }
  });

  return markers;
};

/**
 * Gets the color representing the route line based on congestion level
 */
export const getCongestionColor = (routeId, vehicleData, fallbackColor) => {
  const data = vehicleData[routeId];
  if (!data) return fallbackColor;
  
  if (data.congestion_level === 'blocked') return '#ff3b30';
  if (data.congestion_level === 'warning') return '#ffb300';
  return '#00d4aa';
};
