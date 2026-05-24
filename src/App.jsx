import { useState, useEffect, useRef } from 'react';
import './index.css';

import { getVehicleRouteSummary, getAiBriefing, getTerminalLogs } from './services/vehicleApi';
import { getHourlyForecast } from './services/tmdApi';
import { getWaterLevels, getDamLevels, getShelters, getTmdWarnings, getRouteRisk } from './services/externalApi';
import { renderVehicleTrafficBadges, getCongestionColor } from './components/VehicleTrafficLayer';

const WEATHER_STATIONS = [
  { id: 'CM_CITY',       name: 'เมืองเชียงใหม่', lat: 18.788, lon: 98.985 },
  { id: 'MAE_RIM',       name: 'แม่ริม',          lat: 18.914, lon: 98.944 },
  { id: 'MAE_TAENG',     name: 'แม่แตง',          lat: 19.121, lon: 98.943 },
  { id: 'SAN_SAI',       name: 'สันทราย',          lat: 18.850, lon: 99.040 },
  { id: 'HANG_DONG',     name: 'หางดง',            lat: 18.685, lon: 98.918 },
  { id: 'SAN_KAMPHAENG', name: 'สันกำแพง',         lat: 18.745, lon: 99.115 },
];

const CM_RISK_POINTS = [
  { name: 'ช้างคลาน',   lat: 18.778, lon: 98.995, severity: 0.9 },
  { name: 'กาดก้อม',    lat: 18.775, lon: 98.988, severity: 0.8 },
  { name: 'สถานีรถไฟ',  lat: 18.785, lon: 99.015, severity: 0.7 },
  { name: 'ป่าตัน',     lat: 18.815, lon: 98.995, severity: 0.85 },
];

const ROUTES_BASE = [
  { id: 'A', name: 'เส้นทาง A — ทล.1',              color: '#22c55e', status: 'ปลอดภัย',     desc: 'ถนนสายหลัก ทล.1 ระดับน้ำลดลงต่อเนื่อง' },
  { id: 'B', name: 'เส้นทาง B — ทล.118',            color: '#f59e0b', status: 'เสี่ยงปานกลาง', desc: 'ทล.118 น้ำท่วมบางส่วน ระดับน้ำคงที่'   },
  { id: 'C', name: 'เส้นทาง C — บ้านสันทราย',       color: '#ef4444', status: 'เสี่ยงสูง',    desc: 'ทางลัดตัดผ่านพื้นที่น้ำหลากฉับพลัน'    },
];

const TOGGLE_LABELS = {
  flood: 'น้ำท่วม', wind: 'ลม', history: 'ประวัติ',
  cloud: 'เมฆ', satellite: 'ดาวเทียม', sarMask: 'SAR', vehicles: 'ยานพาหนะ',
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
const SHELTER_ICONS = {
  hospital:     { emoji: '🏥', color: 'rgba(59,130,246,0.8)'  },
  fire_station: { emoji: '🚒', color: 'rgba(239,68,68,0.8)'   },
  police:       { emoji: '🚔', color: 'rgba(29,111,206,0.8)'  },
  shelter:      { emoji: '🏠', color: 'rgba(34,197,94,0.8)'   },
  assembly_point:{ emoji: '👥', color: 'rgba(245,158,11,0.8)' },
};

const SphereMap = ({ activeRoute, routePaths, stationData, incidents, toggles, vehicleData, gistdaRiskPoints, shelters }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layersRef = useRef({ polylines: {}, markers: [], stations: [], incidents: [], sarPolygons: [], trafficMarkers: [], riskCircles: [], rainAreas: [], shelterMarkers: [] });
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
            center: { lon: 98.99, lat: 18.79 },
            zoom: 12,
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
    gistdaRiskPoints.forEach(pt => {
      const circle = new window.sphere.Circle({ lon: pt.lon, lat: pt.lat }, 1200, {
        lineColor: 'rgba(59,130,246,0.35)', fillColor: 'rgba(59,130,246,0.06)',
      });
      mapInstance.current.Overlays.add(circle);
      layersRef.current.riskCircles.push(circle);
    });
  }, [gistdaRiskPoints]);

  useEffect(() => {
    if (!mapInstance.current || !window.sphere) return;
    layersRef.current.stations.forEach(s => mapInstance.current.Overlays.remove(s));
    layersRef.current.stations = [];
    WEATHER_STATIONS.forEach(st => {
      const d = stationData[st.id]; if (!d) return;
      const rainValNum = parseFloat(d.rr);
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
  }, [stationData]);

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
      const lineColor = toggles.vehicles
        ? getCongestionColor(route.id, vehicleData, route.color)
        : (isActive ? route.color : '#2d3e50'); // standard hex color safety

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
  }, [incidents]);

  useEffect(() => {
    if (!mapInstance.current || !window.sphere) return;
    layersRef.current.sarPolygons.forEach(p => mapInstance.current.Overlays.remove(p));
    layersRef.current.sarPolygons = [];
    if (toggles.sarMask) {
      const polys = [
        [{ lon:99.01,lat:18.79 },{ lon:99.02,lat:18.81 },{ lon:99.03,lat:18.80 },{ lon:99.025,lat:18.785 }],
        [{ lon:98.98,lat:18.76 },{ lon:98.99,lat:18.77 },{ lon:98.97,lat:18.77 },{ lon:98.975,lat:18.755 }],
      ];
      polys.forEach(pts => {
        const p = new window.sphere.Polygon(pts, { lineColor:'rgba(59,130,246,0.4)', fillColor:'rgba(59,130,246,0.15)' });
        mapInstance.current.Overlays.add(p); layersRef.current.sarPolygons.push(p);
      });
    }
  }, [toggles.sarMask]);

  useEffect(() => {
    if (!mapInstance.current || !window.sphere) return;
    layersRef.current.rainAreas.forEach(p => mapInstance.current.Overlays.remove(p));
    layersRef.current.rainAreas = [];

    // Render rain coverage area polygons when toggles.cloud is enabled
    if (toggles.cloud) {
      WEATHER_STATIONS.forEach(st => {
        const d = stationData[st.id];
        if (d && d.rr > 0) {
          // Draw a gorgeous rain cloud coverage diamond polygon over the rainy area
          const radiusScale = Math.max(0.02, d.rr * 0.007); // dynamic cloud size
          const pts = [
            { lon: st.lon, lat: st.lat + radiusScale },
            { lon: st.lon + radiusScale * 1.2, lat: st.lat },
            { lon: st.lon, lat: st.lat - radiusScale },
            { lon: st.lon - radiusScale * 1.2, lat: st.lat },
            { lon: st.lon, lat: st.lat + radiusScale } // close
          ];

          const fillColor = d.rr > 10
            ? 'rgba(239, 68, 68, 0.08)' // heavy: red cloud cell
            : d.rr > 4
              ? 'rgba(245, 158, 11, 0.07)'  // moderate: amber cloud cell
              : 'rgba(59, 130, 246, 0.05)'; // light: blue cloud cell
          const lineColor = d.rr > 10
            ? 'rgba(239, 68, 68, 0.35)'
            : d.rr > 4
              ? 'rgba(245, 158, 11, 0.3)'
              : 'rgba(59, 130, 246, 0.25)';

          const poly = new window.sphere.Polygon(pts, { lineColor, fillColor });
          mapInstance.current.Overlays.add(poly);
          layersRef.current.rainAreas.push(poly);
        }
      });
    }
  }, [stationData, toggles.cloud]);

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
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,7,15,0.85)', zIndex: 1000, fontFamily: 'sans-serif' }}>
          <div className="sync-dot" style={{ width: 12, height: 12, marginBottom: 12 }} />
          <span style={{ fontSize: 13, color: '#f0f6fc', letterSpacing: '0.5px' }}>กำลังเชื่อมต่อ GISTDA Sphere Map...</span>
        </div>
      )}
      {mapError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,7,15,0.92)', zIndex: 1000, fontFamily: 'sans-serif', padding: 20, textAlign: 'center', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12 }}>
          <span style={{ fontSize: 32, marginBottom: 12 }}>⚠️</span>
          <strong style={{ fontSize: 15, color: '#ff3b30', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>การเชื่อมต่อแผนที่ขัดข้อง (Map Error)</strong>
          <p style={{ fontSize: 11, color: '#8b949e', maxWidth: 280, lineHeight: 1.6 }}>ไม่สามารถโหลด SDK ได้ คีย์แผนที่ในระบบอาจผิดพลาดหรือขาดอายุการใช้งาน กรุณาเช็คตัวแปร VITE_GISTDA_MAP_KEY ใน .env</p>
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
  const [toggles, setToggles] = useState({ flood: true, wind: true, history: false, cloud: true, satellite: true, sarMask: true, vehicles: true });

  const [incidents, setIncidents] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [decisionLogs, setDecisionLogs] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const [gistdaRiskPoints, setGistdaRiskPoints] = useState(CM_RISK_POINTS);

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

  const [terminalLogs, setTerminalLogs] = useState([]);
  const [cctvExpanded, setCctvExpanded] = useState(true);

  const addToast = (text, type = 'info') => {
    const id = Math.random();
    setToasts(p => [...p, { id, text, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 6000);
  };

  const addLog = (routeName, warn = false, customReason = null) => {
    const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const reasons = [
      'ดึงข้อมูลดาวเทียม Sentinel-1A ตรวจประเมินพื้นที่แห้งสำเร็จ',
      'ระดับสัญญาณน้ำล่างเกณฑ์สูงสุด ปลอดภัยในการลุยภารกิจ',
      'กรมอุตุนิยมวิทยา TMD ยืนยันกระแสฝนลดลง',
    ];
    const reason = customReason || reasons[Math.floor(Math.random() * reasons.length)];
    const officer = ['วิทยา ล.ศ.', 'สมชาติ พ.ต.ท.', 'นพดล ร.ต.อ.', 'อรรถ จ.ส.ต.'][Math.floor(Math.random() * 4)];
    setDecisionLogs(p => [{ route: routeName, time: t, reason, officer, warn }, ...p.slice(0, 8)]);
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

  const fetchGistdaFloodData = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/gistda/flood');
      const data = await res.json();
      if (Array.isArray(data)) {
        const pts = data
          .filter(p => p.province === 'เชียงใหม่' || p.province_name === 'เชียงใหม่' || p.province === 'Chiang Mai')
          .map(p => ({ name: p.amphoe || p.district || 'GISTDA', lat: parseFloat(p.latitude || p.lat), lon: parseFloat(p.longitude || p.lon), severity: parseFloat(p.severity || 0.8) }));
        if (pts.length > 0) {
          setGistdaRiskPoints(pts);
          addToast(`ดึงข้อมูลจุดเสี่ยงน้ำท่วม GISTDA สำเร็จ (${pts.length} พิกัด)`, 'success');
        }
      }
    } catch (_) {}
  };

  const fetchRegionalWeather = async () => {
    const results = {};
    let successCount = 0;
    for (const st of WEATHER_STATIONS) {
      try {
        const data = await getHourlyForecast(st.lat, st.lon);
        if (data?.WeatherForecasts?.[0]?.forecasts?.[0]) {
          results[st.id] = data.WeatherForecasts[0].forecasts[0].data;
          successCount++;
        }
      } catch(_) {}
    }

    if (successCount > 0) {
      setStationData(results);
      addToast(`เชื่อมต่อข้อมูลอากาศ TMD สำเร็จ (${successCount} สถานี)`, 'success');
    } else {
      // TMD server offline or token expired fallback
      const fallbacks = {
        'CM_CITY': { tc: 27.8, rr: 2.5, ws: 3.2, wd: 220 },
        'MAE_RIM': { tc: 22.4, rr: 12.4, ws: 5.6, wd: 180 },
        'MAE_TAENG': { tc: 28.1, rr: 6.2, ws: 4.1, wd: 200 },
        'SAN_SAI': { tc: 26.5, rr: 1.5, ws: 1.8, wd: 90 },
        'HANG_DONG': { tc: 26.0, rr: 4.8, ws: 2.0, wd: 100 },
        'SAN_KAMPHAENG': { tc: 27.0, rr: 8.5, ws: 3.0, wd: 210 },
      };
      setStationData(fallbacks);
      addToast('⚠️ เชื่อมต่อ TMD ล้มเหลว — ดึงข้อมูลคาดการณ์เชิงสถิติของจังหวัดแทน', 'warn');
    }
  };

  const cityCur = stationData['CM_CITY'] || { tc: null, rr: null, ws: null, wd: null };

  const fetchRealRoutes = async () => {
    const coords = {
      A: [[98.985, 18.788], [99.018, 18.825]],
      B: [[98.985, 18.788], [98.950, 18.805]],
      C: [[98.985, 18.788], [99.005, 18.792]],
    };

    const [mlRisks, ...osrmResults] = await Promise.allSettled([
      getRouteRisk(),
      ...['A', 'B', 'C'].map(id =>
        fetch(`https://router.project-osrm.org/route/v1/driving/${coords[id][0][0]},${coords[id][0][1]};${coords[id][1][0]},${coords[id][1][1]}?overview=full&geometries=geojson`)
          .then(r => r.json())
      ),
    ]);

    const mlData = mlRisks.status === 'fulfilled' ? mlRisks.value : null;
    const paths = {};

    ['A', 'B', 'C'].forEach((id, i) => {
      const osrm = osrmResults[i];
      if (osrm.status !== 'fulfilled' || !osrm.value.routes?.[0]) return;
      const route = osrm.value.routes[0];
      const points = route.geometry.coordinates.map(c => ({ lon: c[0], lat: c[1] }));

      let risk, depth;
      if (mlData?.[id]) {
        risk  = mlData[id].risk;
        depth = mlData[id].depth_est;
      } else {
        // Geometric fallback when ML endpoint unavailable
        let score = 0;
        points.forEach(p => {
          gistdaRiskPoints.forEach(pt => { const d = getDist(p, pt); if (d < 1200) score += (1 - d/1200) * pt.severity; });
          incidents.forEach(inc => { const d = getDist(p, inc); if (d < 1200) score += (1 - d/1200) * inc.severity * 2.5; });
        });
        const rain = Math.max(1, (cityCur.rr || 0) / 4);
        risk  = Math.min(Math.round((score / points.length) * 1000 * rain), 99);
        depth = Math.max(0.1, risk / 65).toFixed(1);
      }

      paths[id] = {
        points,
        distance: (route.distance / 1000).toFixed(1),
        duration: Math.round(route.duration / 60),
        risk,
        depth,
      };
    });

    setRoutePaths(paths);
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
      html: 'สวัสดีครับ ยินดีต้อนรับสู่ระบบ <strong>FloodNav</strong> ระบบนำทางเลี่ยงอุทกภัยเชียงใหม่<br/>กรุณาสอบถามเส้นทาง สภาพน้ำท่วม หรือสั่งปักหมุดจุดเสี่ยงได้ครับ<br/><span style="color:var(--text-3);font-size:10px">ข้อมูล: GISTDA sphere · TMD · OSRM · Supabase CCTV</span>',
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

  const filteredRiskPoints = (gistdaRiskPoints || []).filter(pt => {
    if (!geoSearch) return true;
    const s = geoSearch.toLowerCase();
    return pt.name.toLowerCase().includes(s) || pt.lat.toString().includes(s) || pt.lon.toString().includes(s);
  });

  const activeData = { ...ROUTES_BASE.find(r => r.id === activeRoute), ...routePaths[activeRoute] };
  const allRoutesData = ROUTES_BASE.map(r => ({ ...r, ...routePaths[r.id] }));

  // TMD warnings take priority over AI briefing for alert level
  const tmdAlertText = tmdWarnings?.warnings?.[0]?.description ?? tmdWarnings?.data?.[0]?.warning ?? null;
  const alertLevel = tmdAlertText ? 3 : (briefing.alertLevel ?? 1);
  const alertLevelClass = alertLevel >= 3 ? 'alert-3' : alertLevel === 2 ? 'alert-2' : 'alert-1';
  const hasTmdWarning = Boolean(tmdAlertText);

  return (
    <div id="app-container">

      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type === 'success' ? 'success' : t.type === 'warn' ? 'warn' : ''}`}>
            <span>{t.type === 'success' ? '✓' : t.type === 'warn' ? '⚠' : '●'}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      {/* ── Double Header ── */}
      <header className="gov-double-header no-print">
        <div className="gov-header-row-1">
          <div className="gov-platform-title">
            <span className="gov-seal-icon">🛡️</span>
            <div className="header-title">
              <h1 style={{ fontSize: '15px', fontWeight: '800', letterSpacing: '0.5px' }}>ศูนย์บัญชาการสถานการณ์ภัยพิบัติแห่งชาติ (GISTDA National Disaster Command Center)</h1>
              <span style={{ fontSize: '9px', color: 'var(--text-3)' }}>CO-OPERATIONAL PORTAL · GISTDA · TMD · DDPM</span>
            </div>
          </div>

          <div className="header-center">
            <div className="status-chip province">
              <span className="status-dot live" />
              เชียงใหม่
            </div>
            <div className={`status-chip ${alertLevelClass}`}>
              <span className="status-dot live" />
              ระดับแจ้งเตือน {alertLevel}
            </div>
          </div>

          <div className="header-right">
            <div className="weather-strip">
              <div className="weather-strip-item">
                <label>อุณหภูมิ</label>
                <strong>{cityCur.tc != null ? `${cityCur.tc.toFixed(1)}°C` : '—'}</strong>
              </div>
              <div className="weather-strip-item">
                <label>ฝน</label>
                <strong>{cityCur.rr != null ? `${cityCur.rr.toFixed(1)} mm` : '—'}</strong>
              </div>
              <div className="weather-strip-item">
                <label>ลม</label>
                <strong>{cityCur.ws != null ? `${cityCur.ws.toFixed(1)} m/s` : '—'}</strong>
              </div>
            </div>
            <div className="header-clock">{clock}</div>
          </div>
        </div>

        <div className="gov-header-row-2">
          <nav className="gov-nav-tabs">
            <button className={`gov-tab-btn ${activeTab === 'cockpit' ? 'active' : ''}`} onClick={() => setActiveTab('cockpit')}>
              📡 ศูนย์บัญชาการหลัก (Tactical Cockpit)
            </button>
            <button className={`gov-tab-btn ${activeTab === 'geospatial' ? 'active' : ''}`} onClick={() => setActiveTab('geospatial')}>
              🛰️ วิเคราะห์สารสนเทศภูมิศาสตร์ (Geospatial Analysis)
            </button>
            <button className={`gov-tab-btn ${activeTab === 'resources' ? 'active' : ''}`} onClick={() => setActiveTab('resources')}>
              👥 การจัดสรรกำลังพลและกู้ชีพ (Logistics Planner)
            </button>
            <button className={`gov-tab-btn ${activeTab === 'executive' ? 'active' : ''}`} onClick={() => setActiveTab('executive')}>
              📊 สรุปสถานการณ์ระดับผู้บริหาร (Executive Report)
            </button>
          </nav>
        </div>
      </header>

      {/* ── Alert Banner — TMD warning overrides AI briefing ── */}
      <div className={`alert-banner level-${alertLevel >= 3 ? 3 : alertLevel === 2 ? 2 : 1}${hasTmdWarning ? ' tmd-warning' : ''}`}>
        <span className="alert-banner-icon">
          {alertLevel >= 3 ? '🔴' : alertLevel === 2 ? '🟡' : '🔵'}
        </span>
        <span className="alert-banner-text">
          {hasTmdWarning
            ? `[TMD แจ้งเตือนทางการ] ${tmdAlertText}`
            : briefingLoading
              ? 'กำลังประมวลผลสถานการณ์...'
              : (briefing.text || 'ระบบพร้อมปฏิบัติการ — กำลังประเมินสถานการณ์น้ำท่วมพื้นที่เชียงใหม่')}
        </span>
        {briefing.timestamp && !hasTmdWarning && (
          <span className="alert-banner-meta">{briefing.timestamp}</span>
        )}
        <button className="alert-banner-refresh" onClick={fetchBriefing} disabled={briefingLoading}>
          {briefingLoading ? '...' : 'รีเฟรช'}
        </button>
      </div>

      {/* ── Main Layout ── */}
      {activeTab === 'cockpit' && (
        <div className="main-layout">

        {/* ── Map Section ── */}
        <section className="map-section">

          {/* Top-left map badge */}
          <div className="map-badge map-badge-tl">
            <span className="status-dot live" style={{ background: 'var(--safe)' }} />
            GISTDA sphere · SAR · {new Date().toLocaleDateString('th-TH')}
          </div>

          {/* CCTV Drawer */}
          <div className={`cctv-drawer ${cctvExpanded ? '' : 'collapsed'}`}>
            <div className="cctv-drawer-header">
              <span>กล้อง CCTV</span>
              <button
                onClick={() => setCctvExpanded(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}
              >✕</button>
            </div>
            <div className="cctv-feed">
              <span className="cctv-feed-id">CAM-01</span>
              <span className="cctv-feed-name">ทล.1 สายเหนือ</span>
              <span className="cctv-feed-count">{vehicleData.A?.vehicle_count ?? 0} คัน</span>
            </div>
            <div className="cctv-feed">
              <span className="cctv-feed-id">CAM-02</span>
              <span className="cctv-feed-name">ทล.1 สายใต้</span>
              <span className="cctv-feed-count">{vehicleData.A?.vehicle_count ?? 0} คัน</span>
            </div>
            <div className="cctv-feed">
              <span className="cctv-feed-id">CAM-03</span>
              <span className="cctv-feed-name">ทล.118 ดอยสะเก็ด</span>
              <span className="cctv-feed-count">{vehicleData.B?.vehicle_count ?? 0} คัน</span>
            </div>
            <div className="cctv-feed">
              <span className="cctv-feed-id">CAM-04</span>
              <span className="cctv-feed-name">สันทราย สายรอง</span>
              <span className="cctv-feed-count">{vehicleData.C?.vehicle_count ?? 0} คัน</span>
            </div>
          </div>

          {!cctvExpanded && (
            <button className="cctv-toggle-btn" onClick={() => setCctvExpanded(true)}>
              ▶ CCTV
            </button>
          )}

          {/* Map */}
          <div className="map-inner">
            <SphereMap
              activeRoute={activeRoute}
              routePaths={routePaths}
              stationData={stationData}
              incidents={incidents}
              toggles={toggles}
              vehicleData={vehicleData}
              gistdaRiskPoints={gistdaRiskPoints}
              shelters={shelters}
            />
          </div>

          {/* Active route float card */}
          <div className="route-float">
            <div className="route-float-title">เส้นทางที่เลือก</div>
            <div className="route-float-name">{activeData.name}</div>
            <div className="route-float-score">
              <span className="risk-badge" style={{ color: activeData.color }}>
                {activeData.risk ?? '--'}%
              </span>
              <div className="route-stats">
                <div className="route-stat-row">
                  <span>เวลา</span><strong>{activeData.duration ?? '--'} น.</strong>
                </div>
                <div className="route-stat-row">
                  <span>ระยะ</span><strong>{activeData.distance ?? '--'} กม.</strong>
                </div>
                <div className="route-stat-row">
                  <span>น้ำลึก</span>
                  <strong style={{ color: activeData.depth > 0.8 ? 'var(--danger)' : 'var(--text-1)' }}>
                    {activeData.depth ?? '--'} ม.
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <div className="sidebar-scroll">

            {/* Resources */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">ทรัพยากรภาคสนาม</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                {[
                  { label: 'เรือกู้ภัย',    value: resources.boats,   color: 'var(--safe)'         },
                  { label: 'ทีมกู้ชีพ',     value: resources.teams,   color: 'var(--blue-primary)' },
                  { label: 'รอช่วยเหลือ',   value: `${resources.waiting} คน`, color: 'var(--danger)' },
                ].map(item => (
                  <div key={item.label} style={{ background: 'var(--bg-panel)', borderRadius: 'var(--radius)', padding: '10px 8px', textAlign: 'center', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-3)', marginBottom: 4 }}>{item.label}</div>
                    <strong style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: item.color }}>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Routes */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">เส้นทางแนะนำ</span>
                <span className="sb-section-badge">OSRM</span>
              </div>
              {allRoutesData.map((route, i) => {
                const tagClass = route.id === 'A' ? 'tag-safe' : route.id === 'B' ? 'tag-warn' : 'tag-danger';
                return (
                  <div
                    key={route.id}
                    className={`route-card ${activeRoute === route.id ? 'active' : ''}`}
                    onClick={() => { setActiveRoute(route.id); addLog(route.name); }}
                  >
                    <div className="route-card-top">
                      <div className="route-card-name">
                        <span className="route-dot" style={{ background: route.color }} />
                        {route.name}
                      </div>
                      <span className={`route-status-tag ${tagClass}`}>{route.status}</span>
                    </div>
                    <div className="route-card-metrics">
                      <span>#{i+1}</span>
                      <span>{route.duration ?? '--'} น.</span>
                      <span>{route.distance ?? '--'} กม.</span>
                      <span>{route.depth ?? '--'} ม.</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Weather table */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">สภาพอากาศ</span>
                <span className="sb-section-badge">TMD Live</span>
              </div>
              <table className="weather-table">
                <thead>
                  <tr>
                    <th>สถานี</th><th>°C</th><th>ฝน (mm)</th><th>ลม</th>
                  </tr>
                </thead>
                <tbody>
                  {WEATHER_STATIONS.map(st => {
                    const d = stationData[st.id];
                    const rainNum = d?.rr != null && !isNaN(d.rr) ? Number(d.rr) : null;
                    const fillPct = rainNum != null ? Math.min(rainNum / 20 * 100, 100) : 0;
                    return (
                      <tr key={st.id}>
                        <td>{st.name}</td>
                        <td>{d?.tc?.toFixed(1) ?? '—'}</td>
                        <td>
                          <div className="rain-indicator">
                            <div className="rain-bar">
                              <div className="rain-fill" style={{ width: `${fillPct}%` }} />
                            </div>
                            {rainNum != null ? rainNum.toFixed(1) : '—'}
                          </div>
                        </td>
                        <td>{d?.ws?.toFixed(1) ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* River water levels */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">ระดับน้ำแม่น้ำ</span>
                <span className="sb-section-badge">กรมทรัพยากรน้ำ</span>
              </div>
              {waterLevels
                ? waterLevels.map(st => {
                    const hasData = st.level != null;
                    const pctOfWarn = (hasData && st.warning_level) ? st.level / st.warning_level : null;
                    const valClass = !hasData ? 'nodata' : pctOfWarn == null ? 'safe' : pctOfWarn >= 1 ? 'danger' : pctOfWarn >= 0.8 ? 'warn' : 'safe';
                    return (
                      <div key={st.id} className="water-row">
                        <div className="water-row-name">
                          <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{st.id}</div>
                          <div>{st.name}</div>
                        </div>
                        <span className={`water-level-val ${valClass}`}>
                          {hasData ? `${st.level.toFixed(2)} ม.` : '—'}
                        </span>
                      </div>
                    );
                  })
                : <div style={{ fontSize: 10, color: 'var(--text-3)', padding: '6px 0' }}>กำลังดึงข้อมูล...</div>
              }
            </div>

            {/* Dam levels */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">ระดับน้ำเขื่อน</span>
                <span className="sb-section-badge">กรมชลประทาน</span>
              </div>
              {damLevels
                ? damLevels.map(dam => {
                    const pct = dam.percent;
                    const fillClass = pct == null ? '' : pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'safe';
                    const pctColor = pct == null ? 'var(--text-3)' : pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--safe)';
                    return (
                      <div key={dam.code} className="dam-row">
                        <div className="dam-row-header">
                          <span className="dam-name">{dam.name}</span>
                          <span className="dam-pct" style={{ color: pctColor }}>
                            {pct != null ? `${pct}%` : '—'}
                          </span>
                        </div>
                        <div className="dam-track">
                          <div className={`dam-fill ${fillClass}`} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
                        </div>
                        <div className="dam-meta">
                          <span>ความจุ {dam.capacity_mcm} ล้านลบ.ม.</span>
                          {dam.inflow != null && <span>ไหลเข้า {dam.inflow} ม³/วิ</span>}
                        </div>
                      </div>
                    );
                  })
                : <div style={{ fontSize: 10, color: 'var(--text-3)', padding: '6px 0' }}>กำลังดึงข้อมูล...</div>
              }
            </div>

            {/* Traffic / CCTV */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">ปริมาณจราจร CCTV</span>
              </div>
              {allRoutesData.map(route => {
                const vd = vehicleData[route.id];
                const pct = Math.min((vd?.vehicle_count ?? 0) / 30 * 100, 100);
                const barColor = route.id === 'A' ? 'var(--safe)' : route.id === 'B' ? 'var(--warn)' : 'var(--danger)';
                const cTag = vd?.congestion_level === 'blocked' ? 'tag-danger' : vd?.congestion_level === 'warning' ? 'tag-warn' : 'tag-safe';
                const cLabel = vd?.congestion_level === 'blocked' ? 'ติดขัด' : vd?.congestion_level === 'warning' ? 'หนาแน่น' : 'ปกติ';
                return (
                  <div key={route.id} className="traffic-row">
                    <span className="traffic-route-label">{route.id}</span>
                    <div className="traffic-bar-track">
                      <div className="traffic-bar-fill" style={{ width: `${pct}%`, background: barColor }} />
                    </div>
                    <span className="traffic-count">{vd?.vehicle_count ?? 0}</span>
                    <span className={`congestion-tag ${cTag}`}>{cLabel}</span>
                  </div>
                );
              })}
            </div>

            {/* Route comparison bars */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">เปรียบเทียบเส้นทาง</span>
              </div>
              {[
                { label: 'เวลาเดินทาง (นาที)', vals: allRoutesData.map(r => r.duration ?? 0), max: 60 },
                { label: 'ความเสี่ยง (%)',     vals: allRoutesData.map(r => r.risk     ?? 0), max: 100 },
              ].map(({ label, vals, max }) => (
                <div key={label} className="comp-row">
                  <div className="comp-label">
                    <span>{label}</span>
                    <span>{vals.map(v => v).join(' · ')}</span>
                  </div>
                  <div className="comp-track">
                    {allRoutesData.map((r, i) => (
                      <div key={r.id} className="comp-bar" style={{ width: `${(vals[i] / max) * 100}%`, background: r.color }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Resource optimizer */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">จัดสรรทรัพยากรกู้ภัย</span>
                {optimizerRunning && <span className="sb-section-badge">{optimizerProgress}%</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 10 }}>
                {allRoutesData.map((route, idx) => {
                  const isActive = optimizerRunning && (
                    (idx === 0 && optimizerProgress > 20 && optimizerProgress < 60) ||
                    (idx === 1 && optimizerProgress > 40 && optimizerProgress < 80) ||
                    (idx === 2 && optimizerProgress > 60)
                  );
                  const tagClass = route.id === 'A' ? 'tag-safe' : route.id === 'B' ? 'tag-warn' : 'tag-danger';
                  const lbl = optimizerRunning
                    ? ['จำลอง','วิเคราะห์','ประมวลผล'][idx]
                    : route.id === 'C' ? 'เฝ้าระวัง' : 'ปกติ';
                  return (
                    <div key={route.id} style={{ background: isActive ? 'var(--blue-dim)' : 'var(--bg-panel)', border: `1px solid ${isActive ? 'var(--blue-primary)' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: '8px 6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-3)', marginBottom: 4 }}>พื้นที่ {route.id}</div>
                      <span className={`route-status-tag ${tagClass}`}>{lbl}</span>
                    </div>
                  );
                })}
              </div>
              {optimizerRunning && (
                <div style={{ height: 4, background: 'var(--bg-panel-alt)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${optimizerProgress}%`, background: 'var(--blue-primary)', transition: 'width 0.1s', borderRadius: 2 }} />
                </div>
              )}
              <button
                style={{ width: '100%', background: optimizerRunning ? 'var(--bg-panel-alt)' : 'var(--blue-dim)', border: '1px solid var(--border-strong)', color: optimizerRunning ? 'var(--text-3)' : '#60a5fa', borderRadius: 'var(--radius)', padding: '7px', fontSize: 11, fontFamily: 'var(--font-th)', fontWeight: 600, cursor: optimizerRunning ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}
                onClick={runResourceOptimizer}
                disabled={optimizerRunning}
              >
                {optimizerRunning ? 'กำลังประมวลผล...' : 'วิเคราะห์จัดสรรทรัพยากร'}
              </button>
            </div>

            {/* Layer toggles */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">ชั้นข้อมูลแผนที่</span>
              </div>
              <div className="toggle-grid">
                {Object.entries(toggles).map(([k, v]) => (
                  <div key={k} className="toggle-item">
                    <span>{TOGGLE_LABELS[k] || k}</span>
                    <div
                      className={`toggle-switch ${v ? 'on' : ''}`}
                      onClick={() => setToggles(p => ({ ...p, [k]: !p[k] }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Decision log */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">บันทึกการตัดสินใจ</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {decisionLogs.map((log, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-panel)', border: `1px solid ${log.warn ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`, borderLeft: `3px solid ${log.warn ? 'var(--danger)' : 'var(--blue-primary)'}`, padding: '8px 10px', borderRadius: 'var(--radius)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 3 }}>
                      <strong style={{ color: log.warn ? 'var(--danger)' : '#60a5fa' }}>{log.route}</strong>
                      <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{log.time}</span>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.4 }}>{log.reason}</p>
                    <span style={{ fontSize: 9, color: 'var(--text-3)' }}>ผู้บันทึก: {log.officer}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* System log */}
            <div className="sb-section">
              <div className="sb-section-header">
                <span className="sb-section-title">บันทึกระบบ</span>
              </div>
              <div style={{ background: 'var(--bg-base)', borderRadius: 'var(--radius)', padding: '8px 10px', maxHeight: 110, overflowY: 'auto' }}>
                {terminalLogs.length === 0 ? (
                  <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    เชื่อมต่อศูนย์ปฏิบัติการ GISTDA...
                  </div>
                ) : terminalLogs.map((log, idx) => (
                  <div key={idx} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', lineHeight: 1.6, color: log.type === 'warn' ? 'var(--warn)' : log.type === 'error' ? 'var(--danger)' : 'var(--text-3)' }}>
                    [{log.time}] {log.text}
                  </div>
                ))}
              </div>
            </div>

          </div>{/* end sidebar-scroll */}

          {/* ── AI Chat ── fixed at sidebar bottom */}
          <div className="chat-section">
            <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'var(--font-en)' }}>
                Typhoon AI · ผู้ช่วยปฏิบัติการ
              </span>
            </div>
            <div className="chat-messages">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`chat-bubble ${msg.role}`}>
                  {msg.html
                    ? <span dangerouslySetInnerHTML={{ __html: msg.html }} />
                    : msg.text}
                  <span className="bubble-time">{msg.time}</span>
                </div>
              ))}
              {isTyping && (
                <div className="chat-typing">
                  <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                </div>
              )}
            </div>
            <div className="chat-input-row">
              <input
                className="chat-input-field"
                placeholder="สอบถามสถานการณ์น้ำท่วม..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
              />
              <button className="chat-send-btn" onClick={() => sendChat()} disabled={isTyping}>
                ส่ง
              </button>
            </div>
          </div>

          <button
            className="mission-btn"
            onClick={() => addToast('เริ่มปฏิบัติการกู้ภัยสำเร็จ — กำลังแจ้งหน่วยงานที่เกี่ยวข้อง', 'success')}
          >
            เริ่มปฏิบัติการกู้ภัย
          </button>

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
                <p>รายงานข้อมูลจุดเสี่ยงภัยแล้ง/น้ำท่วม จากระบบดาวเทียม Sentinel-1A SAR และ GISTDA Sphere Map</p>
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
                  className="alert-banner-refresh"
                  style={{ padding: '6px 12px', fontSize: '11px', whiteSpace: 'nowrap' }}
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
                  <h3>ตารางพิกัดจุดเสี่ยงน้ำท่วม GISTDA Open Data (เชียงใหม่)</h3>
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

              {/* SAR & Radar side */}
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
                      const rainVal = d?.rr != null && !isNaN(d.rr) ? Number(d.rr) : 0;
                      const scale = 220; 
                      const dx = (st.lon - 98.99) * scale;
                      const dy = -(st.lat - 18.79) * scale; 
                      const blipClass = rainVal > 10 ? 'heavy' : rainVal > 3 ? 'moderate' : 'light';
                      
                      return (
                        <React.Fragment key={st.id}>
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
                        </React.Fragment>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '10px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                      <span style={{ color: 'var(--text-3)' }}>ปริมาณฝนเฉลี่ยรายชั่วโมง:</span>
                      <strong>
                        {(WEATHER_STATIONS.reduce((acc, curr) => acc + (stationData[curr.id]?.rr || 0), 0) / WEATHER_STATIONS.length).toFixed(2)} mm/hr
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                      <span style={{ color: 'var(--text-3)' }}>สถานีตรวจวัดฝนสูงสุด:</span>
                      <strong style={{ color: 'var(--warn)' }}>
                        {(() => {
                          let maxSt = null;
                          let maxVal = -1;
                          WEATHER_STATIONS.forEach(s => {
                            const val = stationData[s.id]?.rr || 0;
                            if (val > maxVal) { maxVal = val; maxSt = s.name; }
                          });
                          return `${maxSt || '—'} (${maxVal.toFixed(1)} mm)`;
                        })()}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="gov-card">
                  <div className="gov-card-header">
                    <h3>สถานะ Sentinel-1A SAR Telemetry</h3>
                  </div>
                  <div className="gov-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '11px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-3)' }}>Radar Mode:</span>
                      <strong>Interferometric Wide (IW)</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-3)' }}>Polarisation:</span>
                      <strong>VV + VH Dual-Pol</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-3)' }}>Spatial Resolution:</span>
                      <strong>20m x 20m pixel spacing</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-3)' }}>Processing Level:</span>
                      <strong>L1 GRD (Ground Range)</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-3)' }}>Scan Active:</span>
                      <strong style={{ color: 'var(--safe)' }}>● ACTIVE SCANNING</strong>
                    </div>
                  </div>
                </div>

                <div className="gov-card">
                  <div className="gov-card-header">
                    <h3>วิเคราะห์พื้นที่รับน้ำท่วมขัง (SAR Mask)</h3>
                  </div>
                  <div className="gov-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
                        <span>พื้นที่เสี่ยงน้ำท่วมสะสม (ตาราง กม.)</span>
                        <strong style={{ fontFamily: 'var(--font-mono)' }}>184.2 km²</strong>
                      </div>
                      <div style={{ height: '6px', background: 'var(--bg-panel-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: '64%', height: '100%', background: 'var(--danger)' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
                        <span>พื้นที่เกษตรกรรมได้รับผลกระทบ</span>
                        <strong style={{ fontFamily: 'var(--font-mono)' }}>4,821 ไร่</strong>
                      </div>
                      <div style={{ height: '6px', background: 'var(--bg-panel-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: '48%', height: '100%', background: 'var(--warn)' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
                        <span>พื้นที่ชุมชน/สิ่งปลูกสร้างเสี่ยง</span>
                        <strong style={{ fontFamily: 'var(--font-mono)' }}>12 เขตเทศบาล</strong>
                      </div>
                      <div style={{ height: '6px', background: 'var(--bg-panel-alt)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: '30%', height: '100%', background: 'var(--blue-primary)' }} />
                      </div>
                    </div>

                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius)', padding: '16px', textAlign: 'center' }}>
                      <div>
                        <span style={{ fontSize: '24px' }}>📡</span>
                        <h4 style={{ fontSize: '11px', fontWeight: '700', marginTop: '8px', color: 'var(--text-1)' }}>เชื่อมโยงสถานีดาวเทียม GISTDA</h4>
                        <p style={{ fontSize: '9px', color: 'var(--text-3)', marginTop: '4px', maxWidth: '200px' }}>การดึงข้อมูล SAR polygon overlay มีการอัปเดตทุก 24 ชั่วโมงตามรอบวงโคจรผ่านพิกัดประเทศไทย</p>
                      </div>
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
                      <strong style={{ fontSize: '28px', color: '#fff', fontFamily: 'var(--font-mono)' }}>{optimizerProgress}%</strong>
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
                      {optimizerProgress > 70 && <div style={{ color: '#60a5fa' }}>[ALLO] Allocating teams from high altitude to lower floodplain...</div>}
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
                    { id: 'A', name: 'เขตพื้นที่เหนือ (อำเภอแม่ริม - ช้างเผือก)', officer: 'ร.ต.อ. นพดล สุวรรณดิษฐ์', progress: 90, status: 'ปลอดภัยสูง', tag: 'tag-safe', count: vehicleData.A?.vehicle_count ?? 0, speed: vehicleData.A?.avg_speed ?? 0 },
                    { id: 'B', name: 'เขตพื้นที่กลาง (เมืองเชียงใหม่ - คูเมือง)', officer: 'พ.ต.ท. สมชาติ ประชาไทย', progress: 65, status: 'หนาแน่น/ระวัง', tag: 'tag-warn', count: vehicleData.B?.vehicle_count ?? 0, speed: vehicleData.B?.avg_speed ?? 0 },
                    { id: 'C', name: 'เขตพื้นที่ใต้ (อำเภอสารภี - หางดง)', officer: 'จ.ส.ต. อรรถพล รอดคง', progress: 20, status: 'วิกฤต/น้ำหลาก', tag: 'tag-danger', count: vehicleData.C?.vehicle_count ?? 0, speed: vehicleData.C?.avg_speed ?? 0 }
                  ].map(sector => (
                    <div key={sector.id} style={{ background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ fontSize: '12px', color: '#fff' }}>Sector {sector.id} - {sector.name}</strong>
                          <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '2px' }}>ผู้บัญชาการพื้นที่: {sector.officer}</div>
                        </div>
                        <span className={`route-status-tag ${sector.tag}`}>{sector.status}</span>
                      </div>
                      
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-2)', marginBottom: '4px' }}>
                          <span>ความคืบหน้าการระบายพลช่วยเหลือ</span>
                          <strong>{sector.progress}%</strong>
                        </div>
                        <div style={{ height: '4px', background: 'var(--bg-panel)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ width: `${sector.progress}%`, height: '100%', background: sector.id === 'A' ? 'var(--safe)' : sector.id === 'B' ? 'var(--warn)' : 'var(--danger)' }} />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', fontSize: '10px', marginTop: '4px' }}>
                        <div style={{ background: 'var(--bg-panel)', padding: '4px 6px', borderRadius: '4px' }}>
                          <span style={{ color: 'var(--text-3)' }}>ปริมาณจราจร:</span> <strong style={{ color: '#fff' }}>{sector.count} คัน</strong>
                        </div>
                        <div style={{ background: 'var(--bg-panel)', padding: '4px 6px', borderRadius: '4px' }}>
                          <span style={{ color: 'var(--text-3)' }}>ความเร็วเฉลี่ย:</span> <strong style={{ color: '#fff' }}>{sector.speed} กม/ชม</strong>
                        </div>
                        <div style={{ background: 'var(--bg-panel)', padding: '4px 6px', borderRadius: '4px' }}>
                          <span style={{ color: 'var(--text-3)' }}>ทีมปฏิบัติการ:</span> <strong style={{ color: '#fff' }}>1 ทีมหลัก</strong>
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
                    ศูนย์บัญชาการสถานการณ์ภัยพิบัติเชียงใหม่ร่วม (GISTDA & TMD & DDPM)
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
                    โดยมีปริมาณน้ำฝน {cityCur.rr != null ? `${cityCur.rr.toFixed(1)} มิลลิเมตร/ชั่วโมง` : '—'} 
                    กำลังทิศทางลมพัด {cityCur.ws != null ? `${cityCur.ws.toFixed(1)} เมตร/วินาที` : '—'} 
                    สถานีเฝ้าระวังรายงานระดับน้ำสะสมอยู่ในโหมดเฝ้าระวังปานกลาง
                  </p>

                  <h3 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: '#000' }}>๓. แนะนำเส้นทางและความปลอดภัยทางวิศวกรรม (OSRM Analysis)</h3>
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
                      <strong>(ผู้ว่าราชการจังหวัดเชียงใหม่)</strong><br />
                      ผู้บัญชาการศูนย์ป้องกันและบรรเทาสาธารณภัยเขตเชียงใหม่
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
                            <strong style={{ color: '#60a5fa' }}>{log.route}</strong>
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
      <footer className="gov-footer no-print">
        <span>ระบบวิเคราะห์น้ำท่วมและข้อมูลดาวเทียมศูนย์บัญชาการสถานการณ์ภัยพิบัติเชียงใหม่ร่วม · GISTDA sphere</span>
        <span>TMD · OSRM · Supabase CCTV · Typhoon AI · {new Date().toLocaleDateString('th-TH')}</span>
      </footer>

    </div>
  );
}
