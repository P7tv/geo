import React, { useState, useEffect, useRef } from 'react';
import './index.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getHourlyForecast } from './services/tmdApi';

// --- Geography & Stations Data ---
const WEATHER_STATIONS = [
  { id: 'CM_CITY', name: 'เมืองเชียงใหม่', lat: 18.788, lon: 98.985 },
  { id: 'MAE_RIM', name: 'แม่ริม', lat: 18.914, lon: 98.944 },
  { id: 'MAE_TAENG', name: 'แม่แตง', lat: 19.121, lon: 98.943 },
  { id: 'SAN_SAI', name: 'สันทราย', lat: 18.850, lon: 99.040 },
  { id: 'HANG_DONG', name: 'หางดง', lat: 18.685, lon: 98.918 },
  { id: 'SAN_KAMPHAENG', name: 'สันกำแพง', lat: 18.745, lon: 99.115 }
];

const CM_RISK_POINTS = [
  { name: 'ช้างคลาน', lat: 18.778, lon: 98.995, severity: 0.9 },
  { name: 'กาดก้อม', lat: 18.775, lon: 98.988, severity: 0.8 },
  { name: 'สถานีรถไฟ', lat: 18.785, lon: 99.015, severity: 0.7 },
  { name: 'ป่าตัน', lat: 18.815, lon: 98.995, severity: 0.85 }
];

const ROUTES_BASE = [
  { id: 'A', name: 'เส้นทาง A - ทล.1', color: '#3fb950', status: 'ปลอดภัย', desc: 'ผ่านถนนสายหลัก ทล.1 ระดับน้ำลดลงอย่างต่อเนื่อง หลีกเลี่ยงพื้นที่ลุ่ม' },
  { id: 'B', name: 'เส้นทาง B - ทล.118', color: '#d29922', status: 'เสี่ยงปานกลาง', desc: 'ทล.118 ตัดผ่านพื้นที่น้ำท่วมบางส่วน ระดับน้ำคงที่' },
  { id: 'C', name: 'เส้นทาง C - ทางลัดบ้านสันทราย', color: '#f85149', status: 'เสี่ยงสูง', desc: 'ทางลัดสั้นที่สุด แต่ตัดผ่านพื้นที่ประวัติศาสตร์น้ำหลากฉับพลัน' }
];

function getDist(p1, p2) {
  const R = 6371e3;
  const φ1 = p1.lat * Math.PI/180;
  const φ2 = p2.lat * Math.PI/180;
  const Δφ = (p2.lat-p1.lat) * Math.PI/180;
  const Δλ = (p2.lon-p1.lon) * Math.PI/180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// --- Windy-Style Weather Field Overlay ---
const WeatherFieldOverlay = ({ windSpeed, windDeg, rainfallData }) => {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    // Default to a North-West flow (Diagonal) if data is 0 or missing
    const effectiveDeg = (windDeg === 0 || !windDeg) ? 315 : windDeg;
    const effectiveSpeed = (windSpeed === 0 || !windSpeed) ? 2.5 : windSpeed;

    const particles = Array.from({ length: 200 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      len: 15 + Math.random() * 30,
      opacity: 0.2 + Math.random() * 0.5,
      age: Math.random() * 100
    }));

    const render = () => {
      if (!canvas.width || !canvas.height) return;
      ctx.fillStyle = 'rgba(13, 17, 23, 0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 1. Heatmap (Rainfall Clusters)
      Object.entries(rainfallData).forEach(([id, val]) => {
        if (!val || val <= 0 || isNaN(val)) return;
        const st = WEATHER_STATIONS.find(s => s.id === id);
        if (!st) return;
        const px = (st.lon - 98.9) * (canvas.width / 0.3) + (canvas.width / 2);
        const py = (18.9 - st.lat) * (canvas.height / 0.3) + (canvas.height / 2);
        const radius = Math.max(val * 50, 30);
        if (!isNaN(px) && !isNaN(py)) {
          try {
            const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
            const color = val > 15 ? 'rgba(255, 69, 0, 0.25)' : val > 10 ? 'rgba(255, 140, 0, 0.2)' : 'rgba(255, 215, 0, 0.15)';
            grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);
          } catch(e) {}
        }
      });

      // 2. Wind Flow (Orange-Red Vibrant)
      const angle = ((effectiveDeg + 90) * Math.PI) / 180;
      const moveSpeed = Math.max(effectiveSpeed * 0.7, 1.2);
      
      particles.forEach(p => {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255, 127, 80, ${p.opacity})`; // Coral/Orange-Red
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.moveTo(p.x, p.y);
        const tx = p.x + Math.cos(angle) * p.len;
        const ty = p.y + Math.sin(angle) * p.len;
        ctx.lineTo(tx, ty);
        ctx.stroke();

        // Particle Head for "Flow" direction
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 255, 0, ${p.opacity * 0.7})`;
        ctx.arc(tx, ty, 1.2, 0, Math.PI * 2);
        ctx.fill();

        p.x += Math.cos(angle) * moveSpeed;
        p.y += Math.sin(angle) * moveSpeed;
        p.age++;

        if (p.x < -100 || p.x > canvas.width + 100 || p.y < -100 || p.y > canvas.height + 100 || p.age > 120) {
           p.x = Math.random() * canvas.width;
           p.y = Math.random() * canvas.height;
           p.age = 0;
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };
    render();
    return () => { cancelAnimationFrame(animationFrameId); window.removeEventListener('resize', resize); };
  }, [windSpeed, windDeg, rainfallData]);

  return <canvas ref={canvasRef} className="wind-canvas-modern" />;
};

const CompBar = ({ label, values, unit, max }) => (
  <div className="comp-bar-container">
    <div className="comp-header"><span>{label}</span><span className="mono">(ต่ำ = ดี)</span></div>
    <div className="comp-bars">
      {values.map((v, i) => (
        <div key={i} className="comp-bar-item">
           <div className="comp-bar-fill" style={{ width: `${((v || 0) / max) * 100}%`, background: ROUTES_BASE[i].color }}></div>
           <div className="comp-bar-val mono">{(v || 0)}{unit}</div>
        </div>
      ))}
    </div>
  </div>
);

const LeafletMap = ({ activeRoute, routePaths, stationData }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layersRef = useRef({ polylines: {}, markers: [], stations: [] });

  useEffect(() => {
    if (mapRef.current && !mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, { zoomControl: false }).setView([18.79, 98.99], 11);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO' }).addTo(mapInstance.current);
      CM_RISK_POINTS.forEach(pt => {
        L.circle([pt.lat, pt.lon], { radius: 1000, color: '#388bfd', weight: 1, dashArray: '5,5', fillColor: '#388bfd', fillOpacity: 0.1 }).addTo(mapInstance.current);
      });
    }
  }, []);

  useEffect(() => {
    if (mapInstance.current) {
      layersRef.current.stations.forEach(s => s.remove());
      layersRef.current.stations = [];
      WEATHER_STATIONS.forEach(st => {
        const d = stationData[st.id]; if (!d) return;
        const rainVal = d.rr !== undefined && !isNaN(d.rr) ? d.rr.toFixed(1) : '0.0';
        const icon = L.divIcon({ className: 'station-icon', html: `<div class="station-label mono" style="border-left-color: ${d.rr > 5 ? '#f85149' : '#388bfd'}"><span>${st.name}</span><strong>${rainVal}mm</strong></div>` });
        layersRef.current.stations.push(L.marker([st.lat, st.lon], { icon }).addTo(mapInstance.current));
      });
    }
  }, [stationData]);

  useEffect(() => {
    if (mapInstance.current) {
      Object.values(layersRef.current.polylines).forEach(l => l.remove());
      layersRef.current.markers.forEach(m => m.remove());
      layersRef.current.markers = [];
      ROUTES_BASE.forEach(route => {
        const d = routePaths[route.id]; if (!d) return;
        const isActive = route.id === activeRoute;
        const poly = L.polyline(d.points.map(p => [p.lat, p.lon]), { color: isActive ? route.color : '#444', weight: isActive ? 6 : 2, opacity: isActive ? 1 : 0.2 }).addTo(mapInstance.current);
        layersRef.current.polylines[route.id] = poly;
        if (isActive) {
          layersRef.current.markers.push(L.marker([d.points[0].lat, d.points[0].lon]).addTo(mapInstance.current).bindTooltip('START', { permanent: true, direction: 'top', className: 'map-label' }));
          layersRef.current.markers.push(L.marker([d.points[d.points.length-1].lat, d.points[d.points.length-1].lon]).addTo(mapInstance.current).bindTooltip('END', { permanent: true, direction: 'top', className: 'map-label' }));
        }
      });
    }
  }, [activeRoute, routePaths]);
  return <div ref={mapRef} style={{ height: '100%', width: '100%' }} />;
};

export default function App() {
  const [activeRoute, setActiveRoute] = useState('A');
  const [stationData, setStationData] = useState({});
  const [routePaths, setRoutePaths] = useState({});
  const [clock, setClock] = useState(new Date().toLocaleTimeString('en-GB'));
  const [toggles, setToggles] = useState({ flood: true, wind: true, history: false, cloud: true });

  const fetchRegionalWeather = async () => {
    const results = {};
    for (const st of WEATHER_STATIONS) {
      try {
        const data = await getHourlyForecast(st.lat, st.lon);
        if (data?.WeatherForecasts?.[0]?.forecasts?.[0]) results[st.id] = data.WeatherForecasts[0].forecasts[0].data;
      } catch(e) {}
    }
    setStationData(results);
  };

  const cityCur = stationData['CM_CITY'] || {};

  const fetchRealRoutes = async () => {
    const paths = {};
    const coords = { A: [[98.985, 18.788], [99.018, 18.825]], B: [[98.985, 18.788], [98.950, 18.805]], C: [[98.985, 18.788], [99.005, 18.792]] };
    for (const id of ['A', 'B', 'C']) {
      try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords[id][0][0]},${coords[id][0][1]};${coords[id][1][0]},${coords[id][1][1]}?overview=full&geometries=geojson`);
        const data = await res.json();
        if (data.routes?.[0]) {
          const points = data.routes[0].geometry.coordinates.map(c => ({ lon: c[0], lat: c[1] }));
          let intersectionScore = 0;
          points.forEach(p => { CM_RISK_POINTS.forEach(pt => { const d = getDist(p, pt); if (d < 1200) { intersectionScore += (1 - d/1200) * pt.severity; } }); });
          const risk = Math.min(Math.round((intersectionScore/points.length)*1000 * Math.max(1, (cityCur.rr || 0)/5)), 99);
          paths[id] = { points, distance: (data.routes[0].distance/1000).toFixed(1), duration: Math.round(data.routes[0].duration/60), risk, depth: (risk/50).toFixed(1) };
        }
      } catch(e) {}
    }
    setRoutePaths(paths);
  };

  useEffect(() => {
    const clockInt = setInterval(() => setClock(new Date().toLocaleTimeString('en-GB')), 1000);
    fetchRegionalWeather();
    return () => clearInterval(clockInt);
  }, []);

  useEffect(() => { if (Object.keys(stationData).length > 0) fetchRealRoutes(); }, [stationData]);

  const activeData = { ...ROUTES_BASE.find(r => r.id === activeRoute), ...routePaths[activeRoute] };
  const allRoutesData = ROUTES_BASE.map(r => ({ ...r, ...routePaths[r.id] }));

  return (
    <div id="app-container">
      <header className="top-nav">
        <div className="nav-section">
           <div className="logo-container"><div className="logo-icon">🛡️</div><div className="logo-text"><h1>FloodNav.</h1><p>ADVANCED FIELD FORECAST</p></div></div>
           <div className="nav-pills-group">
              <div className="nav-pill">เชียงใหม่</div><div className="nav-pill pill-alert">ALERT LV.3</div>
           </div>
        </div>
        <div className="nav-section">
           <div className="weather-hud mono">
              <div className="hud-item"><span>TEMP</span><strong>{cityCur.tc?.toFixed(1) || '28.5'}°</strong></div>
              <div className="hud-item"><span>RAIN</span><strong>{cityCur.rr?.toFixed(1) || '0.0'}mm</strong></div>
              <div className="hud-item"><span>WIND</span><strong>{cityCur.ws?.toFixed(1) || '2.1'}k <span style={{ display: 'inline-block', transform: `rotate(${(cityCur.wd || 315)}deg)` }}>↑</span></strong></div>
           </div>
           <div className="user-profile"><div className="user-avatar">🧑‍🚀</div></div>
        </div>
      </header>

      <div className="dashboard-container">
        <section className="map-view">
          {toggles.wind && <WeatherFieldOverlay windSpeed={cityCur.ws} windDeg={cityCur.wd} rainfallData={Object.entries(stationData).reduce((acc, [k,v]) => ({...acc, [k]: v.rr}), {})} />}
          <div className="map-overlay-top-left">
             <div className="overlay-panel">● REGIONAL WEATHER FIELD</div>
             <div className="overlay-panel mono">{new Date().toLocaleDateString('th-TH')} · {clock}</div>
          </div>
          <div className="map-container"><LeafletMap activeRoute={activeRoute} routePaths={routePaths} stationData={stationData} /></div>
          
          <div className="risk-score-floating">
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div><div style={{ fontSize: 10, opacity: 0.6 }}>RISK SCORE PANEL</div><div style={{ fontSize: 16, fontWeight: 800 }}>{activeData.name}</div></div>
                <div className="score-circle mono" style={{ borderColor: activeData.color }}>{activeData.risk || '--'}%</div>
             </div>
             <div className="risk-metrics-list">
                <div className="metric-row"><span>🕒 เวลาเดินทาง</span><strong>{activeData.duration || '--'} น.</strong></div>
                <div className="metric-row"><span>🛣️ ระยะทาง</span><strong>{activeData.distance || '--'} กม.</strong></div>
                <div className="metric-row"><span>💧 ระดับน้ำ</span><strong>{activeData.depth || '--'} ม.</strong></div>
             </div>
          </div>
        </section>

        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="section-title"><h2>TOP-3 RECOMMENDED</h2></div>
            {allRoutesData.map((route, i) => (
              <div key={route.id} className={`route-card ${activeRoute === route.id ? 'active' : ''}`} onClick={() => setActiveRoute(route.id)}>
                 <div className="card-header"><strong>{route.name}</strong><span className="card-status" style={{ color: route.color }}>{route.status}</span></div>
                 <div className="card-metrics mono">#{i+1} · {route.duration || '--'}น. · {route.distance || '--'}กม. · {route.depth || '--'}ม.</div>
              </div>
            ))}
          </div>
          <div className="sidebar-section">
             <div className="section-title"><h2>COMPARISON</h2></div>
             <CompBar label="เวลา" values={allRoutesData.map(r => r.duration || 0)} unit="น." max={60} />
             <CompBar label="ความเสี่ยง" values={allRoutesData.map(r => r.risk || 0)} unit="%" max={100} />
          </div>
          <div className="sidebar-section">
             <div className="section-title"><h2>LAYER CONTROL</h2></div>
             <div className="layer-grid">
                {Object.entries(toggles).map(([k, v]) => (
                  <div key={k} className="layer-toggle-row">
                     <span>{k.toUpperCase()}</span>
                     <div className={`toggle-switch ${v ? 'on' : ''}`} onClick={() => setToggles(p => ({ ...p, [k]: !p[k] }))}></div>
                  </div>
                ))}
             </div>
          </div>
          <div className="sidebar-section xai-chat">
             <div className="chat-bubble">
                <p>ข้อมูลอากาศเชียงใหม่ล่าสุด: {cityCur.rr > 5 ? 'ระวังฝนตกหนักในบางพื้นที่' : 'ทัศนวิสัยปกติ'} เส้นทาง {activeData.name} ยังคงปลอดภัยที่สุด</p>
             </div>
          </div>
          <button className="confirm-btn">START MISSION</button>
        </aside>
      </div>
    </div>
  );
}
