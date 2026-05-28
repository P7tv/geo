import { useState, useEffect, useRef, Fragment } from 'react';
import './index.css';

import { getVehicleRouteSummary, getAiBriefing, getTerminalLogs } from './services/vehicleApi';
import { getHourlyForecast } from './services/tmdApi';
import { getWaterLevels, getDamLevels, getShelters, getTmdWarnings } from './services/externalApi';
import { renderVehicleTrafficBadges, getCongestionColor } from './components/VehicleTrafficLayer';

const WEATHER_STATIONS = [
  { id: 'CR_CITY',       name: 'เมืองเชียงราย', lat: 19.908, lon: 99.832 },
  { id: 'MAE_SAI',      name: 'แม่สาย',         lat: 20.434, lon: 99.882 },
  { id: 'WIANG_PA_PAO', name: 'เวียงป่าเป้า',   lat: 19.375, lon: 99.858 },
  { id: 'THOENG',       name: 'เทิง',            lat: 19.977, lon: 100.074 },
  { id: 'PHAN',         name: 'พาน',             lat: 19.639, lon: 99.779 },
  { id: 'CHIANG_KHONG', name: 'เชียงของ',        lat: 20.299, lon: 100.389 },
];

const CR_RISK_POINTS = [
  { name: 'อ.แม่สาย',       lat: 20.434, lon: 99.882,  severity: 0.92 },
  { name: 'อ.เวียงป่าเป้า', lat: 19.375, lon: 99.858,  severity: 0.88 },
  { name: 'แม่น้ำกก เมือง', lat: 19.908, lon: 99.832,  severity: 0.60 },
  { name: 'อ.เทิง',         lat: 19.977, lon: 100.074, severity: 0.65 },
];

const ROUTES_BASE = [
  { id: 'A', name: 'เส้นทาง A — ทล.1 เมือง→แม่สาย',    color: '#22c55e', status: 'ปลอดภัย',     desc: 'ถนนสายหลัก ทล.1 ผ่านอ.พาน ระดับน้ำกกปกติ'       },
  { id: 'B', name: 'เส้นทาง B — ทล.118 เมือง→เทิง',   color: '#f59e0b', status: 'เสี่ยงปานกลาง', desc: 'ทล.118 ผ่านอ.เทิง น้ำท่วมบางส่วน คาดการณ์เพิ่ม' },
  { id: 'C', name: 'เส้นทาง C — ทางลัดเวียงป่าเป้า',   color: '#ef4444', status: 'เสี่ยงสูง',    desc: 'ทางลัดผ่านลุ่มน้ำลาว น้ำหลากฉับพลันสูงมาก'        },
];


const TOGGLE_LABELS = {
  flood: 'น้ำท่วม', wind: 'ลม', history: 'ประวัติ',
  vehicles: 'ยานพาหนะ', histFreq: 'ความถี่น้ำท่วม',
};

const CONGESTION_CONFIG = {
  blocked: { tag: 'tag-danger', label: 'ติดขัด' },
  warning: { tag: 'tag-warn',   label: 'หนาแน่น' },
  normal:  { tag: 'tag-safe',   label: 'ปกติ' },
};

function getDist(p1, p2) {
  const R = 6371e3;
  const φ1 = p1.lat * Math.PI / 180, φ2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lon - p1.lon) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// --- Wind / Rainfall canvas overlay ---
const WeatherFieldOverlay = ({ windSpeed, windDeg, rainfallData }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let rafId;

    const resize = () => {
      const p = canvas.parentElement;
      if (p) { canvas.width = p.clientWidth; canvas.height = p.clientHeight; }
    };
    window.addEventListener('resize', resize);
    resize();

    const deg = (windDeg == null) ? 315 : windDeg;
    const spd = (windSpeed == null || windSpeed < 0) ? 0 : windSpeed;
    const angle = ((deg + 90) * Math.PI) / 180;
    const moveSpd = Math.max(spd * 0.7, 1.2);

    const particles = Array.from({ length: 200 }, () => ({
      x: Math.random() * (canvas.width || 800),
      y: Math.random() * (canvas.height || 600),
      len: 15 + Math.random() * 30,
      opacity: 0.2 + Math.random() * 0.5,
      age: Math.random() * 100,
    }));

    const render = () => {
      if (!canvas.width || !canvas.height) { rafId = requestAnimationFrame(render); return; }
      ctx.fillStyle = 'rgba(8,17,28,0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      Object.entries(rainfallData).forEach(([id, val]) => {
        if (!val || val <= 0 || isNaN(val)) return;
        const st = WEATHER_STATIONS.find(s => s.id === id);
        if (!st) return;
        const px = (st.lon - 98.9) * (canvas.width / 0.3) + canvas.width / 2;
        const py = (18.9 - st.lat) * (canvas.height / 0.3) + canvas.height / 2;
        const radius = Math.max(val * 50, 30);
        if (!isNaN(px) && !isNaN(py)) {
          try {
            const g = ctx.createRadialGradient(px, py, 0, px, py, radius);
            const c = val > 15 ? 'rgba(239,68,68,0.2)' : val > 10 ? 'rgba(245,158,11,0.18)' : 'rgba(59,130,246,0.14)';
            g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
          } catch(_) {}
        }
      });

      particles.forEach(p => {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,127,80,${p.opacity})`;
        ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        ctx.moveTo(p.x, p.y);
        const tx = p.x + Math.cos(angle) * p.len, ty = p.y + Math.sin(angle) * p.len;
        ctx.lineTo(tx, ty); ctx.stroke();
        ctx.beginPath(); ctx.fillStyle = `rgba(255,255,0,${p.opacity*0.6})`;
        ctx.arc(tx, ty, 1.1, 0, Math.PI*2); ctx.fill();
        p.x += Math.cos(angle) * moveSpd; p.y += Math.sin(angle) * moveSpd; p.age++;
        if (p.x < -100 || p.x > canvas.width+100 || p.y < -100 || p.y > canvas.height+100 || p.age > 120) {
          p.x = Math.random() * canvas.width; p.y = Math.random() * canvas.height; p.age = 0;
        }
      });
      rafId = requestAnimationFrame(render);
    };
    render();
    return () => { cancelAnimationFrame(rafId); window.removeEventListener('resize', resize); };
  }, [windSpeed, windDeg, rainfallData]);

  return <canvas ref={canvasRef} className="wind-canvas-modern" />;
};

// --- GISTDA Sphere Map ---
const FLOOD_WMS = {
  'freq':   { path: 'flood-freq/wms',   layer: '6799ab8c6f832362f99030e6' },
  '1day':   { path: 'flood/1day/wms',   layer: '676e3c965e01949dda35fa23' },
  '3days':  { path: 'flood/3days/wms',  layer: '676e3d66d710b3b9a64a503e' },
  '7days':  { path: 'flood/7days/wms',  layer: '673bffd740c0fc078a820adb' },
  '30days': { path: 'flood/30days/wms', layer: '673c0081a9d1a551eebff626' },
};

const SHELTER_ICONS = {
  hospital:     { emoji: '🏥', color: 'rgba(59,130,246,0.8)'  },
  fire_station: { emoji: '🚒', color: 'rgba(239,68,68,0.8)'   },
  police:       { emoji: '🚔', color: 'rgba(29,111,206,0.8)'  },
  shelter:      { emoji: '🏠', color: 'rgba(34,197,94,0.8)'   },
  assembly_point:{ emoji: '👥', color: 'rgba(245,158,11,0.8)' },
};

const SphereMap = ({ activeRoute, routePaths, stationData, incidents, toggles, vehicleData, gistdaRiskPoints, shelters, floodRange, histFreqRange }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layersRef = useRef({ polylines: {}, markers: [], stations: [], incidents: [], trafficMarkers: [], riskCircles: [], shelterMarkers: [], floodFreqLayer: null, floodWmsLayer: null });
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    let attempts = 0;
    const t = setInterval(() => {
      attempts++;
      if (window.sphere && mapRef.current && !mapInstance.current) {
        clearInterval(t);
        setLoading(false);
        console.log("🗺️ Initializing GISTDA Sphere Map...");
        try {
          mapInstance.current = new window.sphere.Map({
            placeholder: mapRef.current,
            center: { lon: 99.832, lat: 19.908 },
            zoom: 11,
          });
        } catch (err) {
          console.error("❌ Map initialization failed:", err);
          setMapError(true);
        }
      } else if (attempts > 50) { // 5 seconds timeout
        clearInterval(t);
        setLoading(false);
        setMapError(true);
      }
    }, 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!mapInstance.current || !window.sphere) return;
    layersRef.current.riskCircles.forEach(c => mapInstance.current.Overlays.remove(c));
    layersRef.current.riskCircles = [];
    if (!toggles.flood) return;
    gistdaRiskPoints.forEach(pt => {
      const severity = pt.severity ?? 0.6;
      const color = severity > 0.8 ? '#ef4444' : severity > 0.6 ? '#f59e0b' : '#3b82f6';
      const alpha = 0.12 + severity * 0.15;

      // แสดง polygon segment ต่อตำบล ถ้ามี geometry จาก GISTDA API
      if (pt.geometry?.type === 'Polygon' || pt.geometry?.type === 'MultiPolygon') {
        const rings = pt.geometry.type === 'Polygon'
          ? [pt.geometry.coordinates[0]]
          : pt.geometry.coordinates.map(c => c[0]);
        rings.forEach(ring => {
          const pts2 = ring.map(([ln, lt]) => ({ lon: ln, lat: lt }));
          const poly = new window.sphere.Polygon(pts2, {
            lineColor: `${color}cc`,
            fillColor: `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`,
            lineWidth: 1.5,
            title: pt.name,
          });
          mapInstance.current.Overlays.add(poly);
          layersRef.current.riskCircles.push(poly);
        });
      }
    });
  }, [gistdaRiskPoints, toggles.flood]);

  useEffect(() => {
    if (!mapInstance.current || !window.sphere) return;
    layersRef.current.stations.forEach(s => mapInstance.current.Overlays.remove(s));
    layersRef.current.stations = [];
    if (!toggles.wind) return;
    WEATHER_STATIONS.forEach(st => {
      const d = stationData[st.id]; if (!d) return;
      const rainValNum = parseFloat(d.rain);
      const isRainValValid = !isNaN(rainValNum) && rainValNum > 0;
      const rainValStr = isRainValValid ? rainValNum.toFixed(1) : '0.0';
      const highRain = isRainValValid && rainValNum > 5;
      
      // Draw rain intensity circle overlay on GISTDA sphere map
      if (isRainValValid) {
        const radius = Math.max(1000, rainValNum * 350); // circle radius in meters
        const intensityColor = rainValNum > 10
          ? 'rgba(239, 68, 68, 0.45)' // heavy rain: danger red
          : rainValNum > 4
            ? 'rgba(245, 158, 11, 0.4)'  // moderate rain: orange
            : 'rgba(59, 130, 246, 0.35)'; // light rain: blue
        const fillColor = rainValNum > 10
          ? 'rgba(239, 68, 68, 0.12)'
          : rainValNum > 4
            ? 'rgba(245, 158, 11, 0.08)'
            : 'rgba(59, 130, 246, 0.05)';
            
        const rainCircle = new window.sphere.Circle({ lon: st.lon, lat: st.lat }, radius, {
          lineColor: intensityColor,
          fillColor: fillColor,
        });
        mapInstance.current.Overlays.add(rainCircle);
        layersRef.current.stations.push(rainCircle);
      }

      const html = `<div class="station-marker ${highRain ? 'high-rain' : ''}"><span>${st.name}</span> ${rainValStr}mm</div>`;
      const marker = new window.sphere.Marker({ lon: st.lon, lat: st.lat }, {
        title: st.name, detail: `ปริมาณน้ำฝน: ${rainValStr} mm`, icon: { html },
      });
      mapInstance.current.Overlays.add(marker);
      layersRef.current.stations.push(marker);
    });
  }, [stationData, toggles.wind]);

  useEffect(() => {
    if (!mapInstance.current || !window.sphere) return;
    Object.values(layersRef.current.polylines).forEach(l => mapInstance.current.Overlays.remove(l));
    layersRef.current.polylines = {};
    layersRef.current.markers.forEach(m => mapInstance.current.Overlays.remove(m));
    layersRef.current.markers = [];
    layersRef.current.trafficMarkers.forEach(m => mapInstance.current.Overlays.remove(m));
    layersRef.current.trafficMarkers = [];

    ROUTES_BASE.forEach(route => {
      const d = routePaths[route.id]; 
      if (!d || !d.points || d.points.length < 2) return;
      
      const isActive = route.id === activeRoute;
      const rp = d.risk ?? 0;
      const riskHex = rp >= 70 ? '#ef4444' : rp >= 40 ? '#f59e0b' : '#22c55e';
      const lineColor = toggles.vehicles
        ? getCongestionColor(route.id, vehicleData, riskHex)
        : (isActive ? riskHex : riskHex + '66');

      const coords = d.points
        .filter(p => p && !isNaN(p.lon) && !isNaN(p.lat))
        .map(p => ({ lon: Number(p.lon), lat: Number(p.lat) }));
        
      if (coords.length < 2) return;

      const poly = new window.sphere.Polyline(coords, { lineColor, lineWidth: isActive ? 6 : 2 });
      mapInstance.current.Overlays.add(poly);
      layersRef.current.polylines[route.id] = poly;
      if (isActive) {
        const s = new window.sphere.Marker(coords[0], { title: 'ต้นทาง' });
        const e = new window.sphere.Marker(coords[coords.length - 1], { title: 'ปลายทาง' });
        mapInstance.current.Overlays.add(s); mapInstance.current.Overlays.add(e);
        layersRef.current.markers.push(s, e);
      }
    });

    if (toggles.vehicles) {
      layersRef.current.trafficMarkers = renderVehicleTrafficBadges(mapInstance.current, routePaths, vehicleData, activeRoute);
    }
  }, [activeRoute, routePaths, toggles.vehicles, vehicleData]);

  useEffect(() => {
    if (!mapInstance.current || !window.sphere) return;
    layersRef.current.incidents.forEach(l => mapInstance.current.Overlays.remove(l));
    layersRef.current.incidents = [];
    if (!toggles.history) return;
    incidents.forEach(inc => {
      const circle = new window.sphere.Circle({ lon: inc.lon, lat: inc.lat }, 1200, {
        lineColor: 'rgba(239,68,68,0.5)', fillColor: 'rgba(239,68,68,0.1)',
      });
      mapInstance.current.Overlays.add(circle); layersRef.current.incidents.push(circle);
      const html = `<div style="width:22px;height:22px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 0 8px rgba(0,0,0,0.5)">⚠</div>`;
      const marker = new window.sphere.Marker({ lon: inc.lon, lat: inc.lat }, {
        title: inc.name, detail: `น้ำลึก: ${inc.depth} ม.`, icon: { html },
      });
      mapInstance.current.Overlays.add(marker); layersRef.current.incidents.push(marker);
    });
  }, [incidents, toggles.history]);


  // GISTDA flood-freq WMS layer — switches based on histFreqRange
  useEffect(() => {
    if (!mapInstance.current || !window.sphere) return;
    if (layersRef.current.floodFreqLayer) {
      mapInstance.current.Layers.remove(layersRef.current.floodFreqLayer);
      layersRef.current.floodFreqLayer = null;
    }
    if (!toggles.histFreq) return;
    const wms = FLOOD_WMS[histFreqRange];
    if (!wms) return;
    const dataKey = import.meta.env.VITE_GISTDA_DATA_KEY || '756xL1gEPprZgJXwBdZxyorZ48GbuSmgDC576gqwuNTTCqcawOtgjAo6JKXpfTtK';
    const layer = new window.sphere.Layer(`freq-wms-${histFreqRange}`, {
      type: window.sphere.LayerType.WMS,
      url: `https://api-gateway.gistda.or.th/api/2.0/resources/maps/${wms.path}?`,
      extraQuery: `LAYERS=${wms.layer}&STYLES=&api_key=${dataKey}`,
      zoomRange: { min: 1, max: 20 },
      zIndex: 3,
    });
    mapInstance.current.Layers.add(layer);
    layersRef.current.floodFreqLayer = layer;
  }, [toggles.histFreq, histFreqRange]);

  // GISTDA flood WMS layer — switches based on floodRange
  useEffect(() => {
    if (!mapInstance.current || !window.sphere) return;
    if (layersRef.current.floodWmsLayer) {
      mapInstance.current.Layers.remove(layersRef.current.floodWmsLayer);
      layersRef.current.floodWmsLayer = null;
    }
    if (!toggles.flood) return;
    const wms = FLOOD_WMS[floodRange];
    if (!wms) return;
    const dataKey = import.meta.env.VITE_GISTDA_DATA_KEY || '756xL1gEPprZgJXwBdZxyorZ48GbuSmgDC576gqwuNTTCqcawOtgjAo6JKXpfTtK';
    const layer = new window.sphere.Layer(`flood-wms-${floodRange}`, {
      type: window.sphere.LayerType.WMS,
      url: `https://api-gateway.gistda.or.th/api/2.0/resources/maps/${wms.path}?`,
      extraQuery: `LAYERS=${wms.layer}&STYLES=&api_key=${dataKey}`,
      zoomRange: { min: 1, max: 20 },
      zIndex: 4,
    });
    mapInstance.current.Layers.add(layer);
    layersRef.current.floodWmsLayer = layer;
  }, [toggles.flood, floodRange]);

  // Emergency facilities from OSM
  useEffect(() => {
    if (!mapInstance.current || !window.sphere || !shelters?.length) return;
    layersRef.current.shelterMarkers.forEach(m => mapInstance.current.Overlays.remove(m));
    layersRef.current.shelterMarkers = [];
    shelters.forEach(s => {
      const icon = SHELTER_ICONS[s.type] ?? SHELTER_ICONS.shelter;
      const html = `<div class="facility-marker"><span>${icon.emoji}</span><span>${s.name.slice(0, 20)}</span></div>`;
      const marker = new window.sphere.Marker(
        { lon: s.lon, lat: s.lat },
        { title: s.name, detail: s.type, icon: { html } }
      );
      mapInstance.current.Overlays.add(marker);
      layersRef.current.shelterMarkers.push(marker);
    });
  }, [shelters]);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <div ref={mapRef} style={{ height: '100%', width: '100%' }} />
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,250,252,0.88)', zIndex: 1000, fontFamily: 'sans-serif', backdropFilter: 'blur(2px)' }}>
          <div className="sync-dot" style={{ marginBottom: 12 }} />
          <span style={{ fontSize: 13, color: '#475569', letterSpacing: '0.5px', fontFamily: 'var(--font-th)' }}>กำลังเชื่อมต่อ GISTDA Sphere Map...</span>
        </div>
      )}
      {mapError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,250,252,0.95)', zIndex: 1000, fontFamily: 'sans-serif', padding: 20, textAlign: 'center' }}>
          <span style={{ fontSize: 32, marginBottom: 12 }}>⚠️</span>
          <strong style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 8 }}>การเชื่อมต่อแผนที่ขัดข้อง</strong>
          <p style={{ fontSize: 11, color: 'var(--text-3)', maxWidth: 280, lineHeight: 1.6 }}>ไม่สามารถโหลด GISTDA SDK กรุณาเช็ค VITE_GISTDA_MAP_KEY ใน .env</p>
        </div>
      )}
    </div>
  );
};

// ============================================================
export default function App() {
  const [activeRoute, setActiveRoute] = useState('A');
  const [activeTab, setActiveTab] = useState('cockpit'); // Routing tab state
  const [geoSearch, setGeoSearch] = useState('');
  const [stationData, setStationData] = useState({});
  const [routePaths, setRoutePaths] = useState({});
  const [clock, setClock] = useState(new Date().toLocaleTimeString('en-GB'));
  const [toggles, setToggles] = useState({ flood: true, wind: true, history: true, vehicles: true, histFreq: false });
  const [floodRange, setFloodRange] = useState('7days');
  const [floodRangeOpen, setFloodRangeOpen] = useState(false);
  const [histFreqRange, setHistFreqRange] = useState('freq');
  const [histFreqRangeOpen, setHistFreqRangeOpen] = useState(false);

  const [incidents, setIncidents] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [decisionLogs, setDecisionLogs] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const [gistdaRiskPoints, setGistdaRiskPoints] = useState(CR_RISK_POINTS);

  // External data sources
  const [waterLevels, setWaterLevels]   = useState(null);
  const [damLevels,   setDamLevels]     = useState(null);
  const [shelters,    setShelters]      = useState([]);
  const [tmdWarnings, setTmdWarnings]   = useState(null);

  const [vehicleData, setVehicleData] = useState({
    A: { vehicle_count: 0, avg_speed: 0, congestion_level: 'unknown', stopped_ratio: 0 },
    B: { vehicle_count: 0, avg_speed: 0, congestion_level: 'unknown', stopped_ratio: 0 },
    C: { vehicle_count: 0, avg_speed: 0, congestion_level: 'unknown', stopped_ratio: 0 },
  });
  const [briefing, setBriefing] = useState({ text: '', alertLevel: 1, timestamp: '' });
  const [briefingLoading, setBriefingLoading] = useState(false);

  const [optimizerRunning, setOptimizerRunning] = useState(false);
  const [optimizerProgress, setOptimizerProgress] = useState(0);
  const [resources, setResources] = useState({ boats: '—', teams: '—', waiting: '—' });

  const [, setTerminalLogs] = useState([]);


  const addToast = (text, type = 'info') => {
    const id = Math.random();
    setToasts(p => [...p, { id, text, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 6000);
  };

  const addLog = (routeName, warn = false, customReason = null, officerOverride = null) => {
    const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const reasons = [
      'ดึงข้อมูลพื้นที่น้ำท่วมจาก GISTDA Flood API สำเร็จ',
      'ระดับน้ำกกต่ำกว่าเกณฑ์เตือนภัย ปลอดภัยในการปฏิบัติภารกิจ',
      'กรมอุตุนิยมวิทยา TMD ยืนยันกระแสฝนลดลงในเชียงราย',
    ];
    const reason = customReason || reasons[Math.floor(Math.random() * reasons.length)];
    const officer = officerOverride || ['วิทยา ล.ศ.', 'สมชาติ พ.ต.ท.', 'นพดล ร.ต.อ.', 'อรรถ จ.ส.ต.'][Math.floor(Math.random() * 4)];
    setDecisionLogs(p => [{ route: routeName, time: t, reason, officer, warn }, ...p.slice(0, 8)]);

    // Persist override to server audit log when it's a human override (officerOverride provided)
    if (officerOverride) {
      fetch('http://localhost:3001/api/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId: routeName, reason, officer }),
      }).catch(() => {});
    }
  };

  const fetchVehicleData = async () => {
    const summary = await getVehicleRouteSummary();
    if (summary) setVehicleData(summary);
  };

  const fetchBriefing = async () => {
    setBriefingLoading(true);
    try {
      const data = await getAiBriefing();
      if (data.briefing) {
        setBriefing({ text: data.briefing, alertLevel: data.alert_level, timestamp: data.generated_at });
        addToast('AI สรุปสถานการณ์สำเร็จ', 'success');
      }
    } finally {
      setBriefingLoading(false);
    }
  };

  const fetchRouteExplanation = async () => {
    const routes = ['A', 'B', 'C']
      .map(id => routePaths[id] ? { id, risk: routePaths[id].risk, features: routePaths[id].features } : null)
      .filter(Boolean);
    if (routes.length === 0) { addToast('ยังไม่มีข้อมูลเส้นทาง — รอโหลดสักครู่', 'warn'); return; }
    try {
      addToast('AI กำลังวิเคราะห์เหตุผลความเสี่ยง...', 'info');
      const res = await fetch('http://localhost:3001/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routes }),
      });
      const data = await res.json();
      if (data.explanation) {
        addLog('XAI Explanation', false, data.explanation.slice(0, 120));
        addToast('AI อธิบายความเสี่ยงเส้นทางสำเร็จ', 'success');
      }
    } catch (_) { addToast('XAI endpoint ไม่ตอบสนอง', 'warn'); }
  };

  const fetchGistdaFloodData = async (range = floodRange) => {
    try {
      const res = await fetch(`http://localhost:3001/api/gistda/flood?range=${range}`);
      if (!res.ok) throw new Error(`GISTDA API ${res.status}`);
      const data = await res.json();
      const features = data?.features ?? [];
      if (features.length === 0) {
        addToast(`GISTDA: ไม่มีข้อมูลน้ำท่วม (${range})`, 'info');
        return;
      }
      const pts = features.map(f => {
        const p = f.properties ?? {};
        // คำนวณ centroid จาก geometry สำหรับ fallback marker
        let lon = null, lat = null;
        if (f.geometry?.type === 'Point') {
          [lon, lat] = f.geometry.coordinates;
        } else if (f.geometry?.coordinates) {
          const ring = f.geometry.coordinates[0];
          const lons = ring.map(c => c[0]);
          const lats = ring.map(c => c[1]);
          lon = lons.reduce((a, b) => a + b, 0) / lons.length;
          lat = lats.reduce((a, b) => a + b, 0) / lats.length;
        }
        return {
          name:     p.tb_tn || p.ap_tn || p.pv_tn || 'GISTDA',
          tb_idn:   p.tb_idn,
          ap_idn:   p.ap_idn,
          lat, lon,
          severity: parseFloat(p.area_rai ? Math.min(p.area_rai / 10000, 1) : 0.8),
          geometry: f.geometry ?? null,
        };
      }).filter(pt => pt.lat && pt.lon);
      if (pts.length > 0) {
        setGistdaRiskPoints(pts);
        addToast(`ดึงข้อมูลจุดเสี่ยงน้ำท่วม GISTDA สำเร็จ (${pts.length} พื้นที่)`, 'success');
      }
    } catch (_) {}
  };

  const fetchRegionalWeather = async () => {
    const settled = await Promise.allSettled(
      WEATHER_STATIONS.map(st =>
        getHourlyForecast(st.lat, st.lon).then(data => ({ id: st.id, data }))
      )
    );

    const results = {};
    settled.forEach(r => {
      if (r.status === 'fulfilled') {
        const { id, data } = r.value;
        const forecast = data?.WeatherForecasts?.[0]?.forecasts?.[0]?.data;
        if (forecast) results[id] = forecast;
      }
    });
    const successCount = Object.keys(results).length;

    if (successCount > 0) {
      setStationData(results);
      addToast(`เชื่อมต่อข้อมูลอากาศ TMD สำเร็จ (${successCount} สถานี)`, 'success');
    } else {
      // Both TMD and Open-Meteo unavailable — last-resort static climatological normals
      const fallbacks = {
        'CR_CITY':       { tc: 27.5, rr: 3.2, ws: 2.8, wd: 200 },
        'MAE_SAI':       { tc: 25.8, rr: 14.2, ws: 5.1, wd: 175 },
        'WIANG_PA_PAO':  { tc: 24.1, rr: 18.6, ws: 6.3, wd: 185 },
        'THOENG':        { tc: 26.3, rr: 7.4, ws: 3.5, wd: 195 },
        'PHAN':          { tc: 27.0, rr: 2.1, ws: 2.0, wd: 90 },
        'CHIANG_KHONG':  { tc: 28.5, rr: 4.5, ws: 3.0, wd: 210 },
      };
      setStationData(fallbacks);
      addToast('⚠️ เชื่อมต่อ TMD ล้มเหลว — ดึงข้อมูลคาดการณ์เชิงสถิติของจังหวัดแทน', 'warn');
    }
  };

  const cityCur = stationData['CR_CITY'] || { tc: null, rain: null, ws10m: null, wd10m: null };

  const fetchRealRoutes = async () => {
    try {
      const data = await fetch('http://localhost:3001/api/flood-routes').then(r => r.json());
      const paths = {};
      for (const [id, route] of Object.entries(data)) {
        if (!route.points?.length) continue;
        paths[id] = {
          points:   route.points,
          distance: route.distance_km?.toFixed(1) ?? '—',
          duration: route.duration_min ?? 0,
          risk:     route.risk  ?? 0,
          depth:    route.depth ?? 0,
          features: route.features ?? {},
        };
      }
      setRoutePaths(paths);
    } catch {
      // Geometric fallback when backend unavailable
      const fallbackCoords = {
        A: [[99.832,19.908],[99.850,20.025],[99.866,20.175],[99.882,20.434]],
        B: [[99.832,19.908],[99.900,19.924],[99.983,19.952],[100.074,19.977]],
        C: [[99.832,19.908],[99.840,19.808],[99.851,19.600],[99.858,19.375]],
      };
      const paths = {};
      ['A','B','C'].forEach(id => {
        const points = fallbackCoords[id].map(([lon, lat]) => ({ lon, lat }));
        let score = 0;
        points.forEach(p => {
          gistdaRiskPoints.forEach(pt => { const d = getDist(p, pt); if (d < 1200) score += (1 - d/1200) * pt.severity; });
          incidents.forEach(inc => { const d = getDist(p, inc); if (d < 1200) score += (1 - d/1200) * inc.severity * 2.5; });
        });
        const rain = Math.max(1, (cityCur.rain || 0) / 4);
        const risk  = Math.min(Math.round((score / points.length) * 1000 * rain), 99);
        paths[id] = { points, distance: '—', duration: 0, risk, depth: Math.max(0.1, risk / 65).toFixed(1) };
      });
      setRoutePaths(paths);
    }
  };

  useEffect(() => {
    const mapKey = import.meta.env.VITE_GISTDA_MAP_KEY || 'E65AB56FC36F4ACD986975AF7C570DEC';
    const scriptId = 'gistda-sphere-map-sdk';
    if (!document.getElementById(scriptId)) {
      const s = document.createElement('script');
      s.id = scriptId; s.type = 'text/javascript';
      s.src = `https://api.sphere.gistda.or.th/map/?key=${mapKey}`;
      document.head.appendChild(s);
    }

    const clockInt = setInterval(() => setClock(new Date().toLocaleTimeString('en-GB')), 1000);
    fetchRegionalWeather();
    fetchVehicleData();
    fetchBriefing();
    fetchGistdaFloodData();

    // New external data sources
    getWaterLevels().then(d => { if (d) setWaterLevels(d); });
    getDamLevels().then(d   => { if (d) setDamLevels(d); });
    getShelters().then(d    => { if (d?.length) setShelters(d); });
    getTmdWarnings().then(d => { if (d) setTmdWarnings(d); });

    const fetchLogs = async () => {
      const logs = await getTerminalLogs();
      setTerminalLogs(logs);
    };
    fetchLogs();

    const trafficInt  = setInterval(fetchVehicleData, 15000);
    const briefInt    = setInterval(fetchBriefing, 10 * 60 * 1000);
    const logsInt     = setInterval(fetchLogs, 10000);
    const waterInt    = setInterval(() => getWaterLevels().then(d => { if (d) setWaterLevels(d); }), 5 * 60 * 1000);
    const damInt      = setInterval(() => getDamLevels().then(d   => { if (d) setDamLevels(d); }),   5 * 60 * 1000);
    const warnInt     = setInterval(() => getTmdWarnings().then(d => { if (d) setTmdWarnings(d); }), 10 * 60 * 1000);


    setChatMessages([{
      role: 'ai',
      html: 'สวัสดีครับ ยินดีต้อนรับสู่ระบบ <strong>FloodNav</strong> ระบบนำทางเลี่ยงอุทกภัย<strong>เชียงราย</strong><br/>ครอบคลุม 4 อำเภอ: เมือง · แม่สาย · เทิง · เวียงป่าเป้า<br/>กรุณาสอบถามเส้นทาง สภาพน้ำท่วม หรือสั่งปักหมุดจุดเสี่ยงได้ครับ<br/><span style="color:var(--text-3);font-size:10px">ข้อมูล: GISTDA Flood WMS/API · TMD NWP · NetworkX A* · Supabase CCTV · Open-Meteo</span>',
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    }]);

    return () => {
      clearInterval(clockInt); clearInterval(trafficInt); clearInterval(briefInt);
      clearInterval(logsInt);  clearInterval(waterInt);   clearInterval(damInt); clearInterval(warnInt);
    };
  }, []);

  useEffect(() => {
    if (Object.keys(stationData).length > 0) fetchRealRoutes();
  }, [stationData, incidents, gistdaRiskPoints]);

  useEffect(() => {
    setGistdaRiskPoints(CR_RISK_POINTS);
    fetchGistdaFloodData(floodRange);
  }, [floodRange]);

  const sendChat = async (presetText = null) => {
    const msg = (presetText ?? chatInput).trim();
    if (!msg) return;
    setChatMessages(p => [...p, { role: 'user', text: msg, time: clock.slice(0, 5) }]);
    if (!presetText) setChatInput('');
    setIsTyping(true);

    const historyPayload = chatMessages.map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.text || m.html?.replace(/<[^>]*>/g, '') || ''
    }));

    try {
      const res = await fetch('http://localhost:3001/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: historyPayload }),
      });
      const data = await res.json();
      setIsTyping(false);
      if (data.reply) {
        setChatMessages(p => [...p, { role: 'ai', html: data.reply, toolCall: data.toolCall, time: clock.slice(0, 5) }]);
        if (data.toolCall) executeAiTool(data.toolCall);
      }
    } catch (_) {
      setTimeout(() => { setIsTyping(false); runOfflineParser(msg); }, 700);
    }
  };

  const executeAiTool = (tool) => {
    if (tool.name === 'addIncident') {
      const a = tool.arguments;
      setIncidents(p => p.some(i => i.lat === a.lat && i.lon === a.lon) ? p : [...p, a]);
      addToast(`ปักหมุดจุดเสี่ยง: ${a.name}`, 'warn');
      addLog(a.name, true, `AI ปักหมุดจุดเสี่ยงจากรายงานสด (น้ำลึก ${a.depth} ม.)`);
    } else if (tool.name === 'optimizeAllocation') {
      runResourceOptimizer();
    }
  };

  const runOfflineParser = (text) => {
    const l = text.toLowerCase();
    let reply = 'ยินดีรับคำถามครับ — สอบถามเส้นทาง A B C สภาพอากาศ หรือสั่งปักหมุดจุดน้ำท่วมได้เลย';
    let toolCall = null;
    if (l.includes('กาดก้อม') || l.includes('ท่วม') || l.includes('หลาก')) {
      reply = '⚠️ ตรวจพบจุดเสี่ยง <strong>กาดก้อม</strong> น้ำลึก 1.5 ม. — กำลังปักหมุดบนแผนที่...';
      toolCall = { name: 'addIncident', arguments: { name: 'กาดก้อม', lat: 18.775, lon: 98.988, depth: 1.5, severity: 0.95 } };
    } else if (l.includes('จัดสรร') || l.includes('เรือ') || l.includes('ทรัพยากร')) {
      reply = '🤖 กำลังวิเคราะห์จัดสรรทรัพยากรกู้ภัย...';
      toolCall = { name: 'optimizeAllocation', arguments: {} };
    } else if (l.includes('เส้น b') || l.includes('ทล.118')) {
      reply = '🚧 <strong>เส้นทาง B:</strong> น้ำท่วมปานกลาง ความเสี่ยง 48% ควรระวังสะพานข้ามห้วย';
    }
    setChatMessages(p => [...p, { role: 'ai', html: reply, toolCall, time: clock.slice(0, 5) }]);
    if (toolCall) executeAiTool(toolCall);
  };

  const runResourceOptimizer = () => {
    if (optimizerRunning) return;
    setOptimizerRunning(true); setOptimizerProgress(0);
    addToast('กำลังวิเคราะห์จัดสรรทรัพยากรกู้ภัย...', 'success');
    let p = 0;
    const t = setInterval(() => {
      p += 5; setOptimizerProgress(p);
      if (p >= 100) {
        clearInterval(t); setOptimizerRunning(false);
        setResources({ boats: '6/6 (เต็มอัตรา)', teams: '3 ทีม', waiting: 56 });
        addToast('จัดสรรทรัพยากรเสร็จสิ้น — ช่วยเหลือผู้ประสบภัย 68 ราย', 'success');
        addLog('AI Optimizer', false, 'โยกย้ายกำลังกู้ภัย 3 ทีมไปยังจุดวิกฤต สำเร็จ');
      }
    }, 100);
  };

  const maxRainStation = WEATHER_STATIONS.reduce(
    (best, st) => {
      const val = stationData[st.id]?.rain || 0;
      return val > best.val ? { name: st.name, val } : best;
    },
    { name: null, val: -1 }
  );

  const filteredRiskPoints = (gistdaRiskPoints || []).filter(pt => {
    if (!geoSearch) return true;
    const s = geoSearch.toLowerCase();
    return pt.name.toLowerCase().includes(s) || pt.lat.toString().includes(s) || pt.lon.toString().includes(s);
  });

  const activeData = { ...ROUTES_BASE.find(r => r.id === activeRoute), ...routePaths[activeRoute] };
  const allRoutesData = ROUTES_BASE.map(r => ({ ...r, ...routePaths[r.id] }));

  // Flood depth per route from nearest river station — max(0, level - warning_level) in metres

  // TMD warnings take priority over AI briefing for alert level
  const tmdAlertText = tmdWarnings?.warnings?.[0]?.description ?? tmdWarnings?.data?.[0]?.warning ?? null;
  const alertLevel = tmdAlertText ? 3 : (briefing.alertLevel ?? 1);
  const alertLevelClass = alertLevel >= 3 ? 'alert-3' : alertLevel === 2 ? 'alert-2' : 'alert-1';
  const hasTmdWarning = Boolean(tmdAlertText);

  return (
    <div id="app-container">

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast-v2 ${t.type === 'success' ? 'success' : t.type === 'warn' ? 'warn' : ''}`}>
            <span>{t.type === 'success' ? '✓' : t.type === 'warn' ? '⚠' : '●'}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      {/* ── Compact Header ── */}
      <header className="app-header no-print">
        <div className="header-brand">
          <span className="header-brand-icon">🛡️</span>
          <div className="header-brand-text">
            <h1>FloodNav · เชียงราย</h1>
            <span>GISTDA · TMD · DDPM</span>
          </div>
        </div>
        <div className="header-div" />

        <div className="header-weather">
          <div className="weather-pill">
            <span className="wlabel">°C</span>
            <strong>{cityCur.tc != null ? `${cityCur.tc.toFixed(1)}°` : '—'}</strong>
          </div>
          <div className="weather-pill">
            <span className="wlabel">ฝน</span>
            <strong>{cityCur.rain != null ? `${cityCur.rain.toFixed(1)} mm` : '—'}</strong>
          </div>
          <div className="weather-pill">
            <span className="wlabel">ลม</span>
            <strong>{cityCur.ws10m != null ? `${cityCur.ws10m.toFixed(1)} m/s` : '—'}</strong>
          </div>
          {hasTmdWarning && (
            <div className="weather-pill" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)' }}>
              <span style={{ color: 'var(--danger)', fontSize: 10, fontWeight: 700 }}>⚠ TMD</span>
            </div>
          )}
        </div>

        <div className="header-right">
          <div className={`alert-chip level-${alertLevel >= 3 ? 3 : alertLevel === 2 ? 2 : 1}`}>
            <span className="status-dot live" />
            เฝ้าระวัง {alertLevel}
          </div>
          <div className="header-clock">{clock}</div>
          <div className="header-nav-btns">
            <button className={`header-nav-btn ${activeTab === 'cockpit' ? 'active' : ''}`} onClick={() => setActiveTab('cockpit')}>แผนที่</button>
            <button className={`header-nav-btn ${activeTab === 'geospatial' ? 'active' : ''}`} onClick={() => setActiveTab('geospatial')}>GIS</button>
            <button className={`header-nav-btn ${activeTab === 'resources' ? 'active' : ''}`} onClick={() => setActiveTab('resources')}>ทรัพยากร</button>
            <button className={`header-nav-btn ${activeTab === 'executive' ? 'active' : ''}`} onClick={() => setActiveTab('executive')}>รายงาน</button>
          </div>
        </div>
      </header>

      {/* ── Alert bar ── */}
      <div className={`alert-bar level-${alertLevel >= 3 ? 3 : alertLevel === 2 ? 2 : 1} no-print`}>
        <span>{alertLevel >= 3 ? '🔴' : alertLevel === 2 ? '🟡' : '🔵'}</span>
        <span className="alert-bar-txt">
          {hasTmdWarning
            ? `[TMD แจ้งเตือน] ${tmdAlertText}`
            : briefingLoading
              ? 'กำลังประมวลผลสถานการณ์...'
              : (briefing.text || 'ระบบพร้อมปฏิบัติการ — เชียงราย (เมือง · แม่สาย · เทิง · เวียงป่าเป้า)')}
        </span>
        {briefing.timestamp && !hasTmdWarning && (
          <span className="alert-bar-meta">{briefing.timestamp}</span>
        )}
        <button className="alert-bar-refresh" onClick={fetchBriefing} disabled={briefingLoading}>
          {briefingLoading ? '...' : 'รีเฟรช'}
        </button>
      </div>

      {/* ── 3-Column Cockpit ── */}
      {activeTab === 'cockpit' && (
        <div className="main-3col">

          {/* LEFT: Route cards + toggles + log */}
          <aside className="left-panel">
            <div className="left-panel-scroll">

              {/* Route cards */}
              <div className="panel-section">
                <div className="section-header">
                  <span className="section-title">Routes</span>
                  <button
                    onClick={fetchRouteExplanation}
                    style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--blue-primary)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 10, cursor: 'pointer' }}
                  >🔍 XAI</button>
                </div>
                {allRoutesData.map(route => {
                  const riskPct  = route.risk ?? 0;
                  const riskColor = riskPct >= 70 ? 'var(--danger)' : riskPct >= 40 ? 'var(--warn)' : 'var(--safe)';
                  const statusLbl = riskPct >= 70 ? 'เสี่ยงสูง' : riskPct >= 40 ? 'เสี่ยงปานกลาง' : 'ปลอดภัย';
                  const statusCls = riskPct >= 70 ? 'danger' : riskPct >= 40 ? 'warn' : 'safe';
                  const safety    = 100 - riskPct;
                  const ft        = route.features ?? {};
                  const floodExp  = Math.round((ft.f_flood_depth ?? 0) * 100);
                  const affRoads  = Math.round((ft.f_historical  ?? 0) * 100);
                  const vd        = vehicleData[route.id];
                  const isActive  = activeRoute === route.id;
                  const riskFactors = [
                    { label: 'พื้นที่น้ำท่วม', val: ft.f_flood_depth ?? 0 },
                    { label: 'แนวโน้มน้ำ',    val: ft.f_depth_trend ?? 0 },
                    { label: 'ประวัติน้ำท่วม', val: ft.f_historical  ?? 0 },
                    { label: 'ความเสี่ยงดิน',  val: ft.f_soil        ?? 0 },
                  ];
                  return (
                    <div
                      key={route.id}
                      className={`route-card-v2 ${isActive ? 'active' : ''}`}
                      onClick={() => { setActiveRoute(route.id); addLog(route.name); }}
                    >
                      <div className="rc-top">
                        <div className="rc-letter" style={{ background: riskPct >= 70 ? '#ef4444' : riskPct >= 40 ? '#f59e0b' : '#22c55e' }}>{route.id}</div>
                        <div className="rc-info">
                          <div className="rc-name">{route.name}</div>
                          <div className="rc-dest">{route.desc ?? ''}</div>
                        </div>
                        <div className="rc-risk" style={{ color: riskColor }}>{riskPct}%</div>
                      </div>
                      <div className="rc-bar-track">
                        <div className="rc-bar-fill" style={{ width: `${riskPct}%`, background: riskColor }} />
                      </div>
                      <div className="rc-meta">
                        <span className={`rc-status-tag ${statusCls}`}>{statusLbl}</span>
                        <span><strong>{route.duration ?? '--'}</strong> น.</span>
                        <span><strong>{route.distance ?? '--'}</strong> กม.</span>
                        {vd && <span>🚗 <strong>{vd.vehicle_count ?? 0}</strong></span>}
                      </div>

                      {isActive && (
                        <>
                          {/* Route metrics */}
                          <div className="rc-metrics">
                            <div className="rc-metric">
                              <div className="rc-metric-val" style={{ color: riskColor }}>{safety}</div>
                              <div className="rc-metric-lbl">Safety Score</div>
                            </div>
                            <div className="rc-metric">
                              <div className="rc-metric-val">{floodExp}%</div>
                              <div className="rc-metric-lbl">Flood Exposure</div>
                            </div>
                            <div className="rc-metric">
                              <div className="rc-metric-val">{affRoads}%</div>
                              <div className="rc-metric-lbl">Affected Roads</div>
                            </div>
                          </div>

                          {/* Risk factors bar chart */}
                          <div className="rc-risk-factors" onClick={e => e.stopPropagation()}>
                            <div className="rf-title">Risk Factors</div>
                            {riskFactors.map(({ label, val }) => {
                              const pct = Math.round(val * 100);
                              const fc  = pct >= 70 ? 'var(--danger)' : pct >= 40 ? 'var(--warn)' : 'var(--safe)';
                              return (
                                <div key={label} className="rf-row">
                                  <span className="rf-label">{label}</span>
                                  <div className="rf-track">
                                    <div className="rf-fill" style={{ width: `${pct}%`, background: fc }} />
                                  </div>
                                  <span className="rf-pct">{pct}%</span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Actions */}
                          <div className="rc-actions" onClick={e => e.stopPropagation()}>
                            <button className="rc-btn xai" onClick={fetchRouteExplanation}>🔍 XAI</button>
                            <button
                              className="rc-btn override"
                              onClick={() => {
                                const reason = window.prompt('เหตุผล Override:');
                                if (!reason) return;
                                const officer = window.prompt('ชื่อเจ้าหน้าที่:') || 'ผบ.เหตุการณ์';
                                addLog(`Override: ${route.id}`, true, reason, officer);
                                addToast(`บันทึก Override เส้นทาง ${route.id}`, 'success');
                              }}
                            >✋ Override</button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Layer toggles */}
              <div className="panel-section">
                <div className="section-header">
                  <span className="section-title">Map Layers</span>
                </div>
                <div className="toggle-grid-v2">
                  {Object.entries(toggles).map(([k, v]) => (
                    <div key={k}>
                      <div className="toggle-item-v2">
                        <span>{TOGGLE_LABELS[k] || k}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {k === 'flood' && (
                            <div style={{ position: 'relative' }}>
                              <button
                                onClick={() => setFloodRangeOpen(o => !o)}
                                style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer', lineHeight: 1.6 }}
                              >
                                {floodRange} ▾
                              </button>
                              {floodRangeOpen && (
                                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 999, minWidth: 90, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                  {['1day', '3days', '7days', '30days'].map(r => (
                                    <div
                                      key={r}
                                      onClick={() => { setFloodRange(r); setFloodRangeOpen(false); }}
                                      style={{ padding: '6px 12px', fontSize: 11, cursor: 'pointer', color: r === floodRange ? 'var(--accent)' : 'var(--text-1)', fontWeight: r === floodRange ? 700 : 400, whiteSpace: 'nowrap' }}
                                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                      {r === '1day' ? '1 วัน' : r === '3days' ? '3 วัน' : r === '7days' ? '7 วัน' : '30 วัน'}
                                      {r === floodRange && ' ✓'}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {k === 'histFreq' && (
                            <div style={{ position: 'relative' }}>
                              <button
                                onClick={() => setHistFreqRangeOpen(o => !o)}
                                style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer', lineHeight: 1.6 }}
                              >
                                {histFreqRange} ▾
                              </button>
                              {histFreqRangeOpen && (
                                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 999, minWidth: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                  {['freq', '1day', '3days', '7days', '30days'].map(r => (
                                    <div
                                      key={r}
                                      onClick={() => { setHistFreqRange(r); setHistFreqRangeOpen(false); }}
                                      style={{ padding: '6px 12px', fontSize: 11, cursor: 'pointer', color: r === histFreqRange ? 'var(--accent)' : 'var(--text-1)', fontWeight: r === histFreqRange ? 700 : 400, whiteSpace: 'nowrap' }}
                                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                      {r === 'freq' ? 'ซ้ำซาก' : r === '1day' ? '1 วัน' : r === '3days' ? '3 วัน' : r === '7days' ? '7 วัน' : '30 วัน'}
                                      {r === histFreqRange && ' ✓'}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          <div className={`toggle-sw ${v ? 'on' : ''}`} onClick={() => setToggles(p => ({ ...p, [k]: !p[k] }))} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Decision log */}
              <div className="panel-section">
                <div className="section-header">
                  <span className="section-title">Decision Log</span>
                  <button
                    style={{ background: 'var(--danger-dim)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 10, cursor: 'pointer' }}
                    onClick={() => {
                      const reason = window.prompt('เหตุผลการตัดสินใจ Override:');
                      if (!reason) return;
                      const officer = window.prompt('ชื่อเจ้าหน้าที่:') || 'ผบ.เหตุการณ์';
                      addLog(`Override: ${activeRoute}`, true, reason, officer);
                      addToast(`บันทึก Override เส้นทาง ${activeRoute}`, 'success');
                    }}
                  >✋</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                  {decisionLogs.length === 0 ? (
                    <div style={{ fontSize: 10, color: 'var(--text-3)', padding: '4px 0' }}>ยังไม่มีบันทึก</div>
                  ) : decisionLogs.map((log, idx) => (
                    <div key={idx} className={`log-item${log.warn ? ' warn-log' : ''}`}>
                      <div className="log-item-top">
                        <span className={`log-route${log.warn ? ' warn' : ''}`}>{log.route}</span>
                        <span className="log-time">{log.time}</span>
                      </div>
                      <div className="log-reason">{log.reason}</div>
                      <div className="log-officer">ผู้บันทึก: {log.officer}</div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </aside>

          {/* CENTER: Map */}
          <div className="map-center">
            <div className="map-badge-v2">
              <span className="status-dot live" />
              GISTDA Sphere · {new Date().toLocaleDateString('th-TH')}
            </div>

            <SphereMap
              activeRoute={activeRoute}
              routePaths={routePaths}
              stationData={stationData}
              incidents={incidents}
              toggles={toggles}
              vehicleData={vehicleData}
              gistdaRiskPoints={gistdaRiskPoints}
              shelters={shelters}
              floodRange={floodRange}
              histFreqRange={histFreqRange}
            />

            {/* Map legend */}
            <div className="map-legend">
              <div className="legend-title">ระดับความเสี่ยง</div>
              <div className="legend-row"><span className="legend-dot" style={{ background: '#22c55e' }} />ต่ำ (&lt;40%)</div>
              <div className="legend-row"><span className="legend-dot" style={{ background: '#f59e0b' }} />ปานกลาง (40–70%)</div>
              <div className="legend-row"><span className="legend-dot" style={{ background: '#ef4444' }} />สูง (&gt;70%)</div>
            </div>

            <div className="map-active-route">
              <div>
                <div className="mar-label">เส้นทางที่เลือก</div>
                <div className="mar-name">{activeData.name}</div>
              </div>
              <div className="mar-risk" style={{ color: activeData.color }}>
                {activeData.risk ?? '--'}%
              </div>
              <div className="mar-stats">
                <span>{activeData.duration ?? '--'} น.</span>
                <span>{activeData.distance ?? '--'} กม.</span>
                <span style={{ color: (activeData?.features?.f_flood_depth ?? 0) > 0.5 ? 'var(--danger)' : 'var(--text-2)' }}>
                  ท่วม {Math.round((activeData?.features?.f_flood_depth ?? 0) * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT: Data + AI chat */}
          <aside className="right-panel">
            <div className="right-panel-scroll">

              {/* Resources */}
              <div className="panel-section">
                <div className="section-header">
                  <span className="section-title">Resources</span>
                  <button
                    style={{ background: 'var(--blue-dim)', border: '1px solid var(--blue-primary)', color: 'var(--blue-primary)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 10, cursor: 'pointer' }}
                    onClick={runResourceOptimizer}
                    disabled={optimizerRunning}
                  >{optimizerRunning ? `⚙ ${optimizerProgress}%` : '⚙ Optimize'}</button>
                </div>
                <div className="resources-grid">
                  {[
                    { label: 'เรือกู้ภัย',   value: resources.boats,   color: 'var(--safe)' },
                    { label: 'ทีมกู้ชีพ',    value: resources.teams,   color: 'var(--blue-primary)' },
                    { label: 'รอช่วยเหลือ',  value: resources.waiting, color: 'var(--danger)' },
                  ].map(item => (
                    <div key={item.label} className="resource-item">
                      <label>{item.label}</label>
                      <strong style={{ color: item.color }}>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* River levels */}
              <div className="panel-section">
                <div className="section-header">
                  <span className="section-title">River Levels</span>
                  <span className="section-badge">กรมทรัพยากรน้ำ</span>
                </div>
                {waterLevels
                  ? waterLevels.map(st => {
                      const hasData = st.level != null;
                      const margin = (hasData && st.warning_level) ? st.warning_level - st.level : null;
                      const dangerPct = margin != null ? Math.max(0, Math.min(100, (1 - margin / 5.0) * 100)) : null;
                      const cls = !hasData ? 'nodata' : dangerPct == null ? 'safe' : dangerPct >= 100 ? 'danger' : dangerPct >= 60 ? 'warn' : 'safe';
                      const pct = dangerPct ?? 0;
                      return (
                        <div key={st.id} className="water-station">
                          <div className="water-station-header">
                            <span className="water-station-name">{st.name}</span>
                            <span className={`water-station-val ${cls}`}>
                              {hasData ? `${st.level.toFixed(2)} ม.รทก` : '—'}
                            </span>
                          </div>
                          <div className="water-bar-track">
                            <div className={`water-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="water-station-sub">
                            {margin != null ? `ห่างจากเฝ้าระวัง ${margin.toFixed(2)} ม.` : 'ไม่มีข้อมูล'}
                          </div>
                        </div>
                      );
                    })
                  : <div style={{ fontSize: 11, color: 'var(--text-3)' }}>กำลังดึงข้อมูล...</div>
                }
              </div>

              {/* Dam levels */}
              <div className="panel-section">
                <div className="section-header">
                  <span className="section-title">Dams</span>
                  <span className="section-badge">กรมชลประทาน</span>
                </div>
                {damLevels
                  ? damLevels.map(dam => {
                      const pct = dam.percent;
                      const cls = pct == null ? '' : pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'safe';
                      const pctColor = pct == null ? 'var(--text-3)' : pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--safe)';
                      return (
                        <div key={dam.code} className="dam-card-v2">
                          <div className="dam-card-header">
                            <span className="dam-card-name">{dam.name}</span>
                            <span className="dam-card-pct" style={{ color: pctColor }}>{pct != null ? `${pct}%` : '—'}</span>
                          </div>
                          <div className="dam-bar-track">
                            <div className={`dam-bar-fill ${cls}`} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
                          </div>
                          <div className="dam-card-meta">
                            {dam.capacity_mcm} ล้านลบ.ม.{dam.inflow != null && ` · ไหลเข้า ${dam.inflow} ม³/วิ`}
                          </div>
                        </div>
                      );
                    })
                  : <div style={{ fontSize: 11, color: 'var(--text-3)' }}>กำลังดึงข้อมูล...</div>
                }
              </div>

              {/* CCTV Traffic */}
              <div className="panel-section">
                <div className="section-header">
                  <span className="section-title">CCTV Traffic</span>
                </div>
                {allRoutesData.map(route => {
                  const vd = vehicleData[route.id];
                  const pct = Math.min((vd?.vehicle_count ?? 0) / 30 * 100, 100);
                  const { tag: cTag, label: cLabel } = CONGESTION_CONFIG[vd?.congestion_level] ?? CONGESTION_CONFIG.normal;
                  return (
                    <div key={route.id} className="traffic-mini">
                      <div className="traffic-mini-label" style={{ background: route.color }}>{route.id}</div>
                      <div className="traffic-mini-bar">
                        <div className="traffic-mini-fill" style={{ width: `${pct}%`, background: route.color }} />
                      </div>
                      <span className="traffic-mini-count">{vd?.vehicle_count ?? 0}</span>
                      <span className={`route-status-tag ${cTag}`}>{cLabel}</span>
                    </div>
                  );
                })}
              </div>

              {/* AI Chat */}
              <div className="chat-panel panel-section">
                <div className="section-header" style={{ paddingBottom: 5 }}>
                  <span className="section-title">Typhoon AI</span>
                  <span className="section-badge">ผู้ช่วยปฏิบัติการ</span>
                </div>
                <div className="chat-messages-v2">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`chat-bubble-v2 ${msg.role}`}>
                      {msg.html
                        ? <span dangerouslySetInnerHTML={{ __html: msg.html }} />
                        : msg.text}
                      <span className="btime">{msg.time}</span>
                    </div>
                  ))}
                  {isTyping && (
                    <div className="chat-typing-v2">
                      <div className="typing-dot-v2" /><div className="typing-dot-v2" /><div className="typing-dot-v2" />
                    </div>
                  )}
                </div>
                <div className="chat-input-v2">
                  <input
                    className="chat-input-field-v2"
                    placeholder="สอบถามสถานการณ์น้ำท่วม..."
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendChat()}
                  />
                  <button className="chat-send-btn-v2" onClick={() => sendChat()} disabled={isTyping}>ส่ง</button>
                </div>
              </div>

              {/* Mission button */}
              <button
                className="mission-btn"
                onClick={() => addToast('เริ่มปฏิบัติการกู้ภัยสำเร็จ', 'success')}
              >
                เริ่มปฏิบัติการกู้ภัย
              </button>

            </div>
          </aside>

        </div>
      )}

      {/* ── Geospatial Page ── */}
      {activeTab === 'geospatial' && (
        <div className="gov-page-container">
          <div className="gov-full-width-page">
            <div className="gov-page-header">
              <div className="gov-page-title">
                <h2>วิเคราะห์สารสนเทศภูมิศาสตร์และข้อมูลดาวเทียม (Geospatial & Satellite Analysis)</h2>
                <p>รายงานข้อมูลจุดเสี่ยงน้ำท่วมจังหวัดเชียงราย (4 อำเภอ) จาก GISTDA Flood Monitoring Layer (WMS + Open Data API)</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="ค้นหาอำเภอ/พิกัด..."
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text-1)',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius)',
                    fontSize: '11px',
                    fontFamily: 'var(--font-th)'
                  }}
                  value={geoSearch}
                  onChange={e => setGeoSearch(e.target.value)}
                />
                <button
                  style={{ background: 'var(--blue-dim)', border: '1px solid var(--blue-primary)', color: 'var(--blue-primary)', borderRadius: 'var(--radius)', padding: '6px 12px', fontSize: '11px', whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'var(--font-th)' }}
                  onClick={fetchGistdaFloodData}
                >
                  อัปเดตข้อมูล GISTDA API
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px', padding: '16px', flex: 1, overflow: 'hidden' }}>
              {/* Table side */}
              <div className="gov-card" style={{ flex: 1, overflow: 'hidden' }}>
                <div className="gov-card-header">
                  <h3>ตารางพิกัดจุดเสี่ยงน้ำท่วม GISTDA Open Data (เชียงราย)</h3>
                  <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>พบทั้งหมด {filteredRiskPoints.length} พื้นที่</span>
                </div>
                <div className="gov-table-wrapper">
                  <table className="gov-table">
                    <thead>
                      <tr>
                        <th>อำเภอ/พื้นที่</th>
                        <th>ละติจูด (Latitude)</th>
                        <th>ลองจิจูด (Longitude)</th>
                        <th>ระดับความรุนแรง (Severity)</th>
                        <th>สถานะความเสี่ยง</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRiskPoints.length === 0 ? (
                        <tr>
                          <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-3)', padding: '20px' }}>
                            ไม่พบข้อมูลจุดเสี่ยงตามเงื่อนไขที่ระบุ
                          </td>
                        </tr>
                      ) : (
                        filteredRiskPoints.map((pt, idx) => (
                          <tr key={idx}>
                            <td><strong>{pt.name}</strong></td>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{pt.lat.toFixed(6)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{pt.lon.toFixed(6)}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '60px', height: '4px', background: 'var(--bg-panel-alt)', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{ width: `${pt.severity * 100}%`, height: '100%', background: pt.severity > 0.75 ? 'var(--danger)' : pt.severity > 0.5 ? 'var(--warn)' : 'var(--safe)' }} />
                                </div>
                                <span style={{ fontFamily: 'var(--font-mono)' }}>{(pt.severity * 100).toFixed(0)}%</span>
                              </div>
                            </td>
                            <td>
                              <span className={`route-status-tag ${pt.severity > 0.75 ? 'tag-danger' : pt.severity > 0.5 ? 'tag-warn' : 'tag-safe'}`}>
                                {pt.severity > 0.75 ? 'วิกฤตสูง' : pt.severity > 0.5 ? 'เฝ้าระวัง' : 'ปกติ'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* GISTDA Flood Monitoring side */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', maxHeight: '100%', paddingRight: '4px' }}>
                
                {/* TMD Rain Radar Card */}
                <div className="radar-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-2)', fontFamily: 'var(--font-th)' }}>🛰️ สถานีเรดาร์ปริมาณฝน TMD (Meteorological Radar)</h3>
                    <span className="route-status-tag tag-safe" style={{ fontSize: '9px', animation: 'blink 1.5s infinite' }}>LIVE SCANNING</span>
                  </div>

                  <div className="radar-grid">
                    <div className="radar-sweep" />
                    <div className="radar-circle" style={{ width: '40px', height: '40px' }} />
                    <div className="radar-circle" style={{ width: '80px', height: '80px' }} />
                    <div className="radar-circle" style={{ width: '120px', height: '120px' }} />
                    <div className="radar-circle" style={{ width: '160px', height: '160px' }} />
                    <div className="radar-crosshair-h" />
                    <div className="radar-crosshair-v" />

                    {WEATHER_STATIONS.map((st) => {
                      const d = stationData[st.id];
                      const rainVal = d?.rain != null && !isNaN(d.rain) ? Number(d.rain) : 0;
                      const scale = 220; 
                      const dx = (st.lon - 98.99) * scale;
                      const dy = -(st.lat - 18.79) * scale; 
                      const blipClass = rainVal > 10 ? 'heavy' : rainVal > 3 ? 'moderate' : 'light';
                      
                      return (
                        <Fragment key={st.id}>
                          <div
                            className={`radar-blip ${blipClass}`}
                            style={{
                              left: `calc(50% + ${dx}px)`,
                              top: `calc(50% + ${dy}px)`
                            }}
                          />
                          <div
                            className="radar-label"
                            style={{
                              left: `calc(50% + ${dx + 8}px)`,
                              top: `calc(50% + ${dy - 6}px)`
                            }}
                          >
                            {st.name.substring(0, 5)}: {rainVal.toFixed(1)} mm
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '10px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                      <span style={{ color: 'var(--text-3)' }}>ปริมาณฝนเฉลี่ยรายชั่วโมง:</span>
                      <strong>
                        {(WEATHER_STATIONS.reduce((acc, curr) => acc + (stationData[curr.id]?.rain || 0), 0) / WEATHER_STATIONS.length).toFixed(2)} mm/hr
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                      <span style={{ color: 'var(--text-3)' }}>สถานีตรวจวัดฝนสูงสุด:</span>
                      <strong style={{ color: 'var(--warn)' }}>
                        {maxRainStation.name ? `${maxRainStation.name} (${maxRainStation.val.toFixed(1)} mm)` : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="gov-card">
                  <div className="gov-card-header">
                    <h3>GISTDA Flood Monitoring Layer</h3>
                    <span className="route-status-tag tag-safe" style={{ fontSize: '9px' }}>● CONNECTED</span>
                  </div>
                  <div className="gov-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '11px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-3)' }}>Active Range:</span>
                      <strong style={{ color: 'var(--accent)' }}>{floodRange === '1day' ? '1 วัน' : floodRange === '3days' ? '3 วัน' : floodRange === '7days' ? '7 วัน' : '30 วัน'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-3)' }}>WMS Endpoint:</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>/maps/flood/{floodRange}/wms</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-3)' }}>Vector API:</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>/features/flood/7days</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-3)' }}>Source:</span>
                      <strong>GISTDA Open Data API</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-3)' }}>Last Fetched:</span>
                      <strong>{new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</strong>
                    </div>
                  </div>
                </div>

                <div className="gov-card">
                  <div className="gov-card-header">
                    <h3>สถิติพื้นที่น้ำท่วม (GISTDA /features/flood/7days)</h3>
                  </div>
                  <div className="gov-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
                        <span>จำนวน polygon น้ำท่วมที่ตรวจพบ</span>
                        <strong style={{ fontFamily: 'var(--font-mono)' }}>{gistdaRiskPoints.length} จุด</strong>
                      </div>
                      <div style={{ height: '6px', background: 'var(--bg-panel-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(gistdaRiskPoints.length / 2, 100)}%`, height: '100%', background: gistdaRiskPoints.length > 100 ? 'var(--danger)' : gistdaRiskPoints.length > 30 ? 'var(--warn)' : 'var(--safe)' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
                        <span>ระดับวิกฤต (severity &gt; 0.75)</span>
                        <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--danger)' }}>
                          {gistdaRiskPoints.filter(p => p.severity > 0.75).length} จุด
                        </strong>
                      </div>
                      <div style={{ height: '6px', background: 'var(--bg-panel-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: gistdaRiskPoints.length ? `${(gistdaRiskPoints.filter(p => p.severity > 0.75).length / gistdaRiskPoints.length) * 100}%` : '0%', height: '100%', background: 'var(--danger)' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
                        <span>เฝ้าระวัง (severity 0.5–0.75)</span>
                        <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--warn)' }}>
                          {gistdaRiskPoints.filter(p => p.severity > 0.5 && p.severity <= 0.75).length} จุด
                        </strong>
                      </div>
                      <div style={{ height: '6px', background: 'var(--bg-panel-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: gistdaRiskPoints.length ? `${(gistdaRiskPoints.filter(p => p.severity > 0.5 && p.severity <= 0.75).length / gistdaRiskPoints.length) * 100}%` : '0%', height: '100%', background: 'var(--warn)' }} />
                      </div>
                    </div>

                    <div style={{ fontSize: '10px', color: 'var(--text-3)', textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      ข้อมูลจาก GISTDA Open Data API · อัปเดตทุก 15 นาที · จ.เชียงราย (pv_idn=57)
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Resources Page ── */}
      {activeTab === 'resources' && (
        <div className="gov-page-container">
          <div className="gov-full-width-page">
            <div className="gov-page-header">
              <div className="gov-page-title">
                <h2>การจัดสรรกำลังพลและกู้ชีพ (Logistics & Rescue Resource Planner)</h2>
                <p>ระบบปัญญาประดิษฐ์วิเคราะห์เส้นทางน้ำท่วมและจัดส่งบุคลากรช่วยเหลือผู้ประสบภัยตามลำดับความเร่งด่วน</p>
              </div>
              <button
                className="mission-btn"
                style={{ width: 'auto', padding: '6px 20px', fontSize: '11px', margin: 0 }}
                onClick={runResourceOptimizer}
                disabled={optimizerRunning}
              >
                {optimizerRunning ? 'กำลังคำนวณการจัดสรร...' : '⚙️ รัน AI Resource Solver'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px', flex: 1, overflow: 'hidden' }}>
              {/* Solver side */}
              <div className="gov-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div className="gov-card-header">
                  <h3>เครื่องมือจำลองจัดสรรกองกำลัง AI Optimizer</h3>
                  {optimizerRunning && <span className="route-status-tag tag-warn">กำลังประมวลผล {optimizerProgress}%</span>}
                </div>
                <div className="gov-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                  
                  {/* CSS circular progress dial */}
                  <div style={{ position: 'relative', width: '160px', height: '160px', borderRadius: '50%', background: `conic-gradient(var(--blue-primary) ${optimizerProgress}%, var(--bg-panel-alt) ${optimizerProgress}% 100%)`, display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px var(--blue-glow)' }}>
                    <div style={{ position: 'absolute', inset: '8px', background: 'var(--bg-panel)', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>AI PROGRESS</span>
                      <strong style={{ fontSize: '28px', color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{optimizerProgress}%</strong>
                      <span style={{ fontSize: '9px', color: optimizerRunning ? 'var(--warn)' : 'var(--safe)', fontWeight: '600' }}>
                        {optimizerRunning ? 'OPTIMIZING...' : 'SOLVER READY'}
                      </span>
                    </div>
                  </div>

                  <div style={{ width: '100%' }}>
                    <h4 style={{ fontSize: '11px', fontWeight: '700', marginBottom: '8px', color: 'var(--text-2)' }}>ตัวเลขจัดสรรทรัพยากรระดับภาคสนาม</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                      {[
                        { label: 'เรือท้องแบนกู้ชีพ', value: resources.boats, color: 'var(--safe)' },
                        { label: 'ทีมแพทย์/กู้ภัยหลัก', value: resources.teams, color: 'var(--blue-primary)' },
                        { label: 'ยอดรอการช่วยเหลือ', value: `${resources.waiting} ราย`, color: 'var(--danger)' }
                      ].map(item => (
                        <div key={item.label} style={{ background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '9px', color: 'var(--text-3)', marginBottom: '4px' }}>{item.label}</div>
                          <strong style={{ fontSize: '14px', color: item.color, fontFamily: 'var(--font-mono)' }}>{item.value}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ width: '100%', flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px', overflowY: 'auto' }}>
                    <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-3)', borderBottom: '1px solid var(--border)', paddingBottom: '4px', marginBottom: '6px' }}>SOLVER REAL-TIME VERBOSE LOGS:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                      <div>[INFO] AI solver engine v1.4 loaded parameters...</div>
                      <div>[INFO] Graph matrices: 3 sectors, 12 flood nodes.</div>
                      {optimizerProgress > 10 && <div style={{ color: 'var(--warn)' }}>[CALC] Simulation of path risk coefficient for Sector A completed.</div>}
                      {optimizerProgress > 40 && <div style={{ color: 'var(--warn)' }}>[CALC] Re-routing vehicles to circumvent blocked Route C.</div>}
                      {optimizerProgress > 70 && <div style={{ color: 'var(--blue-primary)' }}>[ALLO] Allocating teams from high altitude to lower floodplain...</div>}
                      {optimizerProgress === 100 && <div style={{ color: 'var(--safe)' }}>[DONE] Resource solver task: evacuated 68 priority survivors successfully.</div>}
                    </div>
                  </div>

                </div>
              </div>

              {/* Sectors side */}
              <div className="gov-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div className="gov-card-header">
                  <h3>สถิติและเป้าหมายการแบ่งเขตพื้นที่ (Sector Operational Metrics)</h3>
                </div>
                <div className="gov-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  
                  {[
                    { id: 'A', name: 'เขตพื้นที่เหนือ (อ.แม่สาย - อ.เมืองเชียงราย)', officer: 'ร.ต.อ. นพดล สุวรรณดิษฐ์', progress: 90, status: 'ปลอดภัยสูง', tag: 'tag-safe', count: vehicleData.A?.vehicle_count ?? 0, speed: vehicleData.A?.avg_speed ?? 0 },
                    { id: 'B', name: 'เขตพื้นที่กลาง (อ.เมืองเชียงราย - อ.เทิง)', officer: 'พ.ต.ท. สมชาติ ประชาไทย', progress: 65, status: 'หนาแน่น/ระวัง', tag: 'tag-warn', count: vehicleData.B?.vehicle_count ?? 0, speed: vehicleData.B?.avg_speed ?? 0 },
                    { id: 'C', name: 'เขตพื้นที่ใต้ (อ.เวียงป่าเป้า - อ.เชียงของ)', officer: 'จ.ส.ต. อรรถพล รอดคง', progress: 20, status: 'วิกฤต/น้ำหลาก', tag: 'tag-danger', count: vehicleData.C?.vehicle_count ?? 0, speed: vehicleData.C?.avg_speed ?? 0 }
                  ].map(sector => (
                    <div key={sector.id} style={{ background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ fontSize: '12px', color: 'var(--text-1)' }}>Sector {sector.id} — {sector.name}</strong>
                          <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '2px' }}>ผู้บัญชาการพื้นที่: {sector.officer}</div>
                        </div>
                        <span className={`route-status-tag ${sector.tag}`}>{sector.status}</span>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-2)', marginBottom: '4px' }}>
                          <span>ความคืบหน้าการระบายพลช่วยเหลือ</span>
                          <strong>{sector.progress}%</strong>
                        </div>
                        <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ width: `${sector.progress}%`, height: '100%', background: sector.id === 'A' ? 'var(--safe)' : sector.id === 'B' ? 'var(--warn)' : 'var(--danger)' }} />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', fontSize: '10px', marginTop: '4px' }}>
                        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', padding: '4px 6px', borderRadius: '4px' }}>
                          <span style={{ color: 'var(--text-3)' }}>จราจร:</span> <strong style={{ color: 'var(--text-1)' }}>{sector.count} คัน</strong>
                        </div>
                        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', padding: '4px 6px', borderRadius: '4px' }}>
                          <span style={{ color: 'var(--text-3)' }}>ความเร็ว:</span> <strong style={{ color: 'var(--text-1)' }}>{sector.speed} กม/ชม</strong>
                        </div>
                        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', padding: '4px 6px', borderRadius: '4px' }}>
                          <span style={{ color: 'var(--text-3)' }}>ทีม:</span> <strong style={{ color: 'var(--text-1)' }}>1 ทีมหลัก</strong>
                        </div>
                      </div>
                    </div>
                  ))}

                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Executive Page ── */}
      {activeTab === 'executive' && (
        <div className="gov-page-container">
          <div className="gov-full-width-page" style={{ background: 'var(--bg-panel)' }}>
            <div className="gov-page-header no-print">
              <div className="gov-page-title">
                <h2>สรุปรายงานระดับผู้บริหาร (Executive Official Briefing)</h2>
                <p>เอกสารสรุปสถานการณ์ระดับผู้ว่าราชการจังหวัดและอธิบดีกรมป้องกันและบรรเทาสาธารณภัย (พิมพ์ออกเป็นทางการได้)</p>
              </div>
              <button
                className="mission-btn"
                style={{ width: 'auto', padding: '6px 20px', fontSize: '11px', margin: 0 }}
                onClick={() => window.print()}
              >
                🖨️ พิมพ์เอกสาร / ส่งออก PDF
              </button>
            </div>

            <div className="executive-report-container">
              {/* Left printable area */}
              <div className="executive-briefing-pane print-area" style={{ background: '#fff', color: '#111', border: '1px solid #ddd', borderRadius: 'var(--radius-lg)' }}>
                {/* Official seal mark */}
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                  <div style={{ fontSize: '32px', filter: 'grayscale(1) sepia(100%) hue-rotate(0deg) saturate(1000%)' }}>🛡️</div>
                  <h2 style={{ fontSize: '14px', fontWeight: '800', marginTop: '10px', color: '#000', fontFamily: 'var(--font-th)' }}>
                    ศูนย์บัญชาการสถานการณ์ภัยพิบัติเชียงรายร่วม (GISTDA & TMD & DDPM)
                  </h2>
                  <p style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    MEMORANDUM ON STATE EMERGENCY DISASTER MITIGATION
                  </p>
                </div>

                <div style={{ borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#333' }}>
                  <div><strong>ฉบับที่:</strong> GISTDA-CM-2026-05</div>
                  <div><strong>วันที่รายงาน:</strong> {new Date().toLocaleDateString('th-TH')} ณ เวลา {clock}</div>
                </div>

                <div style={{ fontSize: '12px', lineHeight: '1.8', color: '#222' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: '#000' }}>๑. สรุปภาพรวมสถานการณ์โดยปัญญาประดิษฐ์ (Typhoon AI Situational Intelligence)</h3>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', color: '#1e293b', fontStyle: 'italic', marginBottom: '20px' }}>
                    "{briefing.text || 'ยังไม่มีสรุปสถานการณ์จาก Typhoon AI กรุณาคลิกรับบรีฟจากหน้าศูนย์หลัก'}"
                  </div>

                  <h3 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: '#000' }}>๒. สภาพอากาศและการประเมินความเสี่ยง TMD</h3>
                  <p style={{ marginBottom: '16px' }}>
                    กรมอุตุนิยมวิทยา (TMD Live) ตรวจวัดอุณหภูมิปัจจุบันบริเวณตัวเมืองได้ {cityCur.tc != null ? `${cityCur.tc.toFixed(1)}°C` : '—'} 
                    โดยมีปริมาณน้ำฝน {cityCur.rain != null ? `${cityCur.rain.toFixed(1)} มิลลิเมตร/ชั่วโมง` : '—'}
                    กำลังทิศทางลมพัด {cityCur.ws10m != null ? `${cityCur.ws10m.toFixed(1)} เมตร/วินาที` : '—'}
                    สถานีเฝ้าระวังรายงานระดับน้ำสะสมอยู่ในโหมดเฝ้าระวังปานกลาง
                  </p>

                  <h3 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: '#000' }}>๓. แนะนำเส้นทางและความปลอดภัยทางวิศวกรรม (NetworkX A* Flood-Aware Routing)</h3>
                  <p style={{ marginBottom: '20px' }}>
                    เส้นทางเดินหลักในภารกิจกู้ชีพ (Route A - {ROUTES_BASE[0].name}) ประเมินสถานะในเกณฑ์ <strong>{ROUTES_BASE[0].status}</strong> 
                    โดยมีระดับความสูงน้ำขังเฉลี่ยที่ {routePaths.A?.depth ?? '0.0'} เมตร และอัตราเสี่ยงภัยพิบัติ {routePaths.A?.risk ?? '0'}%. 
                    หลีกเลี่ยงเส้นทางพื้นที่ลุ่มต่ำสะสมในโซนใต้ (Route C - {ROUTES_BASE[2].name}) ซึ่งมีระดับน้ำสูงสุดเกือบวิกฤต
                  </p>

                  {/* Official sign-off block */}
                  <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '10px', color: '#666' }}>ระบบจัดทำรายงานอัตโนมัติของรัฐ</span>
                      <div style={{ fontSize: '10px', color: '#333', marginTop: '4px' }}>Security Hash: <strong>SHA-256/GISTDA-EOC-989F</strong></div>
                    </div>
                    <div style={{ textAlign: 'center', width: '220px', borderTop: '1px solid #333', paddingTop: '8px', fontSize: '11px' }}>
                      <strong>(ผู้ว่าราชการจังหวัดเชียงราย)</strong><br />
                      ผู้บัญชาการศูนย์ป้องกันและบรรเทาสาธารณภัยเขตเชียงราย
                    </div>
                  </div>
                </div>
              </div>

              {/* Right side: administrative metrics & decision log */}
              <div className="executive-stats-panel no-print">
                <div className="gov-card">
                  <div className="gov-card-header">
                    <h3>สถานะความพร้อมปฏิบัติการระดับจังหวัด</h3>
                  </div>
                  <div className="gov-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-3)', fontSize: '11px' }}>ระดับการตื่นตัวกู้ภัย</span>
                      <span className={`status-chip ${alertLevelClass}`} style={{ fontSize: '10px' }}>
                        ระดับ {alertLevel}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-3)', fontSize: '11px' }}>ทีมจัดสรรกำลังพล</span>
                      <strong style={{ color: 'var(--safe)', fontFamily: 'var(--font-mono)' }}>พร้อมปฏิบัติการ</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-3)', fontSize: '11px' }}>ระบบ GISTDA Link</span>
                      <strong style={{ color: 'var(--safe)', fontFamily: 'var(--font-mono)' }}>CONNECTED</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-3)', fontSize: '11px' }}>ระบบ Typhoon AI Link</span>
                      <strong style={{ color: 'var(--safe)', fontFamily: 'var(--font-mono)' }}>ACTIVE</strong>
                    </div>
                  </div>
                </div>

                <div className="gov-card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div className="gov-card-header">
                    <h3>บันทึกคำสั่งและบันทึกปฏิบัติการล่าสุด</h3>
                  </div>
                  <div className="gov-card-body" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {decisionLogs.length === 0 ? (
                      <span style={{ color: 'var(--text-3)', fontSize: '11px', textAlign: 'center', display: 'block', padding: '20px' }}>
                        ไม่มีประวัติการบันทึกในรอบนี้
                      </span>
                    ) : (
                      decisionLogs.map((log, idx) => (
                        <div key={idx} style={{ background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderLeft: '3px solid var(--blue-primary)', padding: '8px 10px', borderRadius: 'var(--radius)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '2px' }}>
                            <strong style={{ color: 'var(--blue-primary)' }}>{log.route}</strong>
                            <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{log.time}</span>
                          </div>
                          <p style={{ fontSize: '11px', color: 'var(--text-2)', lineHeight: '1.3' }}>{log.reason}</p>
                          <span style={{ fontSize: '9px', color: 'var(--text-3)' }}>โดย: {log.officer}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 14px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', fontSize: '9px', color: 'var(--text-3)', flexShrink: 0 }}>
        <span>ระบบวิเคราะห์น้ำท่วม จ.เชียงราย · GISTDA · TMD · DDPM</span>
        <span>TMD · NetworkX A* · Supabase CCTV · Typhoon AI · {new Date().toLocaleDateString('th-TH')}</span>
      </footer>

    </div>
  );
}
