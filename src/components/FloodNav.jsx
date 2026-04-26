import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/FloodNav.css';
import { getHourlyForecast } from '../services/tmdApi';

// Chiang Mai coordinates
const LOCATION = { lat: 18.79, lon: 98.99, name: 'Chiang Mai' };

const ROUTES = [
  {
    id: 'A',
    name: 'Route A',
    tag: 'แนะนำ',
    tagClass: 'tag-safe',
    cardClass: 'active',
    time: 45,
    dist: 12.0,
    depth: 0.2,
    risk: 15,
    color: '#00d4aa',
    dash: null,
    coords: [[18.75, 98.95], [18.77, 98.98], [18.79, 99.02], [18.81, 99.05]]
  },
  {
    id: 'B',
    name: 'Route B',
    tag: 'เฝ้าระวัง',
    tagClass: 'tag-warn',
    cardClass: 'active-warn',
    time: 38,
    dist: 10.5,
    depth: 0.5,
    risk: 48,
    color: '#f59e0b',
    dash: '10,6',
    coords: [[18.75, 98.95], [18.76, 99.00], [18.78, 99.04], [18.82, 99.08]]
  },
  {
    id: 'C',
    name: 'Route C',
    tag: 'อันตราย',
    tagClass: 'tag-danger',
    cardClass: 'active-danger',
    time: 28,
    dist: 8.2,
    depth: 1.1,
    risk: 82,
    color: '#ef4444',
    dash: '4,5',
    coords: [[18.75, 98.95], [18.77, 99.01], [18.79, 99.06], [18.83, 99.10]]
  }
];

const OFFICERS = ['วิทยา ล.ศ.', 'สมชาติ พ.ต.ท.', 'นพดล ร.ต.อ.', 'อรรถ จ.ส.ต.'];

const CONDITION_MAP = {
  1: { l: 'ท้องฟ้าแจ่มใส', i: '☀️' },
  2: { l: 'มีเมฆบางส่วน', i: '🌤️' },
  3: { l: 'เมฆเป็นส่วนมาก', i: '⛅' },
  4: { l: 'มีเมฆมาก', i: '☁️' },
  5: { l: 'ฝนตกเล็กน้อย', i: '🌦️' },
  6: { l: 'ฝนปานกลาง', i: '🌧️' },
  7: { l: 'ฝนหนัก', i: '🌧️' },
  8: { l: 'พายุฟ้าคะนอง', i: '⛈️' },
  9: { l: 'ฝนหนักมาก', i: '🌊' },
  10: { l: 'หมอก', i: '🌫️' }
};

const AI_RESPONSES = {
  'ทำไมถึงแนะนำเส้นทาง A?': (wx) => `เส้น A มีคะแนนความเสี่ยงต่ำสุด <strong>15%</strong> ในขณะที่:
    <div class="xai-block"><ul>
      <li><strong>ความลึก:</strong> 0.2m — ต่ำกว่าเกณฑ์อันตราย</li>
      <li><strong>Sentinel-1A SAR:</strong> ยืนยันพื้นผิวแห้ง</li>
      <li><strong>OSM Road:</strong> ถนนสายหลักเปิดใช้ได้ 100%</li>
      <li><strong>กรม ปภ.:</strong> ไม่มีรายงานเหตุ 12 ชม.ล่าสุด</li>
    </ul></div>`,
  'ผู้รอช่วยกี่คน?': () =>
    `มีประชาชน <strong>124 คน</strong> รอการช่วยเหลือในเขตเชียงใหม่<br/><br/>ทรัพยากรพร้อม: เรือ 4 ลำ · 3 ทีมกู้ภัย`,
  'ถ้าไปเส้น B?': () => `เส้น B <strong>เร็วกว่า 7 นาที</strong> แต่มีความเสี่ยงเพิ่มขึ้น:
    <div class="xai-block"><ul>
      <li><strong>ความลึก:</strong> 0.5m — อาจกีดขวางเรือ</li>
      <li><strong>Risk score:</strong> 48% (สูงกว่า A ถึง 3.2×)</li>
      <li><strong>ผ่าน High Risk Zone:</strong> น้ำไหลเร็ว</li>
    </ul></div>`
};

function windDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function rrClass(v) {
  if (v >= 15) return 'c-danger';
  if (v >= 5) return 'c-warn';
  if (v > 0) return 'c-info';
  return 'c-muted';
}

export default function FloodNav() {
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [clock, setClock] = useState(new Date().toLocaleTimeString('en-GB'));
  const [weather, setWeather] = useState(null);
  const [latestWx, setLatestWx] = useState(null);
  const [logEntries, setLogEntries] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const chatThreadRef = useRef(null);

  // Clock update
  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GB'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch weather (with fallback to mock data)
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const data = await getHourlyForecast(LOCATION.lat, LOCATION.lon);
        if (data?.WeatherForecasts?.[0]?.forecasts) {
          setWeather(data);
          const fc = data.WeatherForecasts[0].forecasts[0];
          const tc = fc.data.tc?.toFixed(1) || '--';
          const rh = fc.data.rh?.toFixed(0) || '--';
          const rr = fc.data.rr?.toFixed(1) || '0.0';
          const ws = fc.data.ws?.toFixed(1) || '--';
          const wd = fc.data.wd != null ? windDir(fc.data.wd) : '--';
          const cond = CONDITION_MAP[fc.data.cond] || { l: '—', i: '❓' };
          setLatestWx({ tc, rh, rr, ws, wd, cond: cond.l });
          return;
        }
      } catch (e) {
        console.warn('TMD API error, using mock data:', e.message);
      }

      // Mock data fallback
      const mockData = {
        WeatherForecasts: [
          {
            forecasts: [
              { data: { tc: 28.5, rh: 72, rr: 8.2, ws: 4.3, wd: 135, cond: 6 } },
              { data: { tc: 27.8, rh: 75, rr: 12.1, ws: 5.1, wd: 140, cond: 6 } },
              { data: { tc: 27.2, rh: 78, rr: 15.5, ws: 6.2, wd: 145, cond: 7 } },
              { data: { tc: 26.9, rh: 80, rr: 18.3, ws: 7.1, wd: 150, cond: 8 } },
              { data: { tc: 26.5, rh: 82, rr: 22.1, ws: 8.2, wd: 155, cond: 8 } },
              { data: { tc: 26.2, rh: 85, rr: 25.5, ws: 9.1, wd: 160, cond: 9 } }
            ]
          }
        ]
      };
      setWeather(mockData);
      const fc = mockData.WeatherForecasts[0].forecasts[0];
      const tc = fc.data.tc?.toFixed(1) || '--';
      const rh = fc.data.rh?.toFixed(0) || '--';
      const rr = fc.data.rr?.toFixed(1) || '0.0';
      const ws = fc.data.ws?.toFixed(1) || '--';
      const wd = fc.data.wd != null ? windDir(fc.data.wd) : '--';
      const cond = CONDITION_MAP[fc.data.cond] || { l: '—', i: '❓' };
      setLatestWx({ tc, rh, rr, ws, wd, cond: cond.l });
    };
    fetchWeather();
    const timer = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Initialize map
  useEffect(() => {
    if (mapRef.current && !mapInstance.current) {
      mapInstance.current = L.map(mapRef.current).setView([LOCATION.lat, LOCATION.lon], 13);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap · © CARTO',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(mapInstance.current);

      // Flood zones
      const zones = [
        { ll: [18.78, 99.00], r: 3200, color: '#ef4444', label: 'Critical\n>1.0m' },
        { ll: [18.82, 99.04], r: 2800, color: '#f59e0b', label: 'High\n0.5-1.0m' },
        { ll: [18.74, 98.96], r: 2500, color: '#3b82f6', label: 'Moderate\n<0.5m' }
      ];
      zones.forEach((z) => {
        L.circle(z.ll, {
          radius: z.r,
          fillColor: z.color,
          color: z.color,
          weight: 1.5,
          opacity: 0.6,
          fillOpacity: 0.18
        })
          .bindPopup(`<strong>${z.label.replace('\n', '</strong><br/>')}</strong>`)
          .addTo(mapInstance.current);
      });

      // Routes
      ROUTES.forEach((r) => {
        const dash = r.dash ? [parseInt(r.dash.split(',')[0]), parseInt(r.dash.split(',')[1])] : [];
        L.polyline(r.coords, {
          color: r.color,
          weight: 4,
          opacity: 0.85,
          dashArray: dash.length ? dash : undefined
        })
          .bindPopup(
            `<strong>${r.name}</strong><br/>${r.time} นาที · ${r.dist} กม. · ความเสี่ยง ${r.risk}%`
          )
          .addTo(mapInstance.current);
      });

      // Waypoints
      const wpIcon = (emoji, color) =>
        L.divIcon({
          html: `<div style="
            width:34px;height:34px;border-radius:50%;
            background:${color};border:3px solid rgba(255,255,255,0.9);
            display:flex;align-items:center;justify-content:center;
            font-size:15px;box-shadow:0 2px 12px rgba(0,0,0,0.5);
          ">${emoji}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        });

      L.marker([18.75, 98.95], { icon: wpIcon('🚨', '#00d4aa') })
        .bindPopup('<strong>สถานีตำรวจ</strong><br/>จุดออกเดินทาง')
        .addTo(mapInstance.current);

      L.marker([18.83, 99.10], { icon: wpIcon('🏘️', '#f59e0b') })
        .bindPopup('<strong>พื้นที่น้ำท่วม</strong><br/>เป้าหมาย · 124 คนรอช่วย')
        .addTo(mapInstance.current);
    }
  }, []);

  // Add log entry
  const addLog = (routeName, isWarn = false, customReason = null) => {
    const reasons = [
      'ความเสี่ยงต่ำสุด + Sentinel-1A ยืนยันสภาพทาง',
      'ระดับน้ำต่ำกว่าเกณฑ์ HAII · เส้นทางพร้อม',
      'ข้อมูล TMD: ฝนหยุดแล้ว · เส้นทางปลอดภัย'
    ];
    const now = new Date();
    const t = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const reason = customReason || reasons[Math.floor(Math.random() * reasons.length)];
    const officer = OFFICERS[Math.floor(Math.random() * OFFICERS.length)];
    setLogEntries((prev) => [
      { route: routeName, time: t, reason, officer, warn: isWarn },
      ...prev.slice(0, 9)
    ]);
  };

  // Route selection
  const handleRouteSelect = (i) => {
    setSelectedRoute(i);
    addLog(ROUTES[i].name, i > 0);
  };

  // Chat functions
  const getAIReply = (text) => {
    if (AI_RESPONSES[text]) return AI_RESPONSES[text](latestWx);
    const lower = text.toLowerCase();
    if (lower.includes('อากาศ') || lower.includes('ฝน') || lower.includes('weather')) {
      return latestWx
        ? `📡 <strong>ข้อมูล TMD Live</strong><br/>🌡 ${latestWx.tc}°C · 💧 ${latestWx.rh}% · 🌧 ${latestWx.rr} mm/hr · 💨 ${latestWx.ws} m/s (${latestWx.wd})<br/>สภาพ: ${latestWx.cond}`
        : 'กำลังโหลดข้อมูลสภาพอากาศ…';
    }
    if (lower.includes('เส้น b')) return AI_RESPONSES['ถ้าไปเส้น B?']();
    if (lower.includes('เส้น c'))
      return `เส้น C <strong>อันตรายมาก</strong> (82%) — ความลึก 1.1m เกินมาตรฐานปลอดภัย ไม่แนะนำ`;
    return 'สามารถถามเรื่องเส้นทาง สภาพอากาศ ทรัพยากร หรือพื้นที่น้ำท่วมได้เลยครับ 🙂';
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: 'user', text: userMsg, time: clock }]);
    setChatInput('');
    setTimeout(() => {
      const aiReply = getAIReply(userMsg);
      setChatMessages((prev) => [...prev, { role: 'ai', html: aiReply, time: clock }]);
    }, 650);
  };

  const handleChipClick = (text) => {
    setChatInput(text);
  };

  // Pre-populate logs and messages
  useEffect(() => {
    setLogEntries([
      { route: 'Route A', time: '21:12', reason: 'เริ่มต้นปฏิบัติการ · ข้อมูล TMD ล่าสุด', officer: 'วิทยา ล.ศ.', warn: false },
      { route: 'Route A', time: '20:58', reason: 'Sentinel-1A ยืนยัน: depth 0.2m safe', officer: 'สมชาติ พ.ต.ท.', warn: false },
      { route: 'Route B', time: '20:35', reason: 'ประเมินเส้น B — ระดับน้ำสูงเกินเกณฑ์', officer: 'นพดล ร.ต.อ.', warn: true }
    ]);

    setChatMessages([
      {
        role: 'ai',
        html: `สวัสดีครับ 👋 ผมคือ <strong>FloodNav AI</strong> ระบบช่วยตัดสินใจเส้นทางกู้ภัยน้ำท่วม<br/>อ้างอิงข้อมูลจาก Sentinel-1, TMD, HAII, LDD, OSM และ กรม ปภ. แบบ real-time`,
        time: clock
      },
      {
        role: 'user',
        text: 'ทำไมถึงแนะนำเส้นทาง A?',
        time: clock
      }
    ]);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (chatThreadRef.current) {
      chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const activeRoute = ROUTES[selectedRoute];

  return (
    <div className="floodnav-container">
      {/* NAVBAR */}
      <nav className="fn-navbar">
        <div className="fn-nb-brand">
          <div className="fn-nb-logo">
            <div className="fn-nb-logo-icon">🚨</div>
            <div className="fn-nb-logo-text">
              Flood<span>Nav</span>
            </div>
          </div>
        </div>
        <div className="fn-nb-center">
          <div className="fn-chip fn-chip-live">
            <div className="fn-dot"></div>LIVE · Sentinel-1A
          </div>
          <div className="fn-chip fn-chip-warn">
            <div className="fn-dot"></div>
            <span>⚠ น้ำท่วมฉับพลัน · เชียงใหม่</span>
          </div>
        </div>
        <div className="fn-nb-right">
          <div className="fn-nb-team">
            <div className="fn-nb-team-dot"></div>
            <span>Rescue Team: Alpha-7</span>
          </div>
          <div className="fn-nb-clock">{clock}</div>
        </div>
      </nav>

      {/* MAIN */}
      <div className="fn-main">
        {/* LEFT SIDEBAR */}
        <aside className="fn-sidebar-left">
          {/* Route Panel */}
          <div className="fn-sec">
            <div className="fn-sec-title">① Route Panel</div>
            <div className="fn-sec-badge">{clock.slice(0, 5)}</div>
          </div>
          <div className="fn-routes-wrap">
            {ROUTES.map((r, i) => (
              <div
                key={r.id}
                className={`fn-rcard ${i === selectedRoute ? r.cardClass : ''}`}
                onClick={() => handleRouteSelect(i)}
              >
                <div className="fn-rcard-top">
                  <div className="fn-rcard-name">{r.name}</div>
                  <div className={`fn-rcard-tag ${r.tagClass}`}>{r.tag}</div>
                </div>
                <div className="fn-rcard-grid">
                  <div className="fn-rg">
                    <div className="fn-rg-label">เวลา</div>
                    <div className="fn-rg-val">{r.time} min</div>
                  </div>
                  <div className="fn-rg">
                    <div className="fn-rg-label">ระยะ</div>
                    <div className="fn-rg-val">{r.dist} km</div>
                  </div>
                  <div className="fn-rg">
                    <div className="fn-rg-label">ความลึก</div>
                    <div className="fn-rg-val">{r.depth} m</div>
                  </div>
                  <div className="fn-rg">
                    <div className="fn-rg-label">ความเสี่ยง</div>
                    <div className="fn-rg-val" style={{ color: r.risk < 40 ? '#00d4aa' : r.risk < 70 ? '#f59e0b' : '#ef4444' }}>
                      {r.risk}%
                    </div>
                  </div>
                </div>
                <div className="fn-riskbar">
                  <div
                    className="fn-riskfill"
                    style={{
                      width: `${r.risk}%`,
                      background: r.risk < 40 ? '#00d4aa' : r.risk < 70 ? '#f59e0b' : '#ef4444'
                    }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          {/* Weather */}
          <div className="fn-sec" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="fn-sec-title">② สภาพอากาศ</div>
            <div className="fn-sec-badge">TMD Live</div>
          </div>
          {weather && latestWx ? (
            <div className="fn-wx-wrap">
              <div className="fn-wx-source">
                <div className="fn-wx-source-dot"></div>
                กรมอุตุนิยมวิทยา
              </div>
              <div className="fn-wx-main">
                <div className="fn-wx-stat">
                  <div className="fn-wx-stat-lbl">🌡 อุณหภูมิ</div>
                  <div className="fn-wx-stat-val">{latestWx.tc}°C</div>
                </div>
                <div className="fn-wx-stat">
                  <div className="fn-wx-stat-lbl">💧 ความชื้น</div>
                  <div className="fn-wx-stat-val">{latestWx.rh}%</div>
                </div>
                <div className="fn-wx-stat">
                  <div className="fn-wx-stat-lbl">🌧 ฝน</div>
                  <div className={`fn-wx-stat-val ${rrClass(parseFloat(latestWx.rr))}`}>{latestWx.rr} mm</div>
                </div>
                <div className="fn-wx-stat">
                  <div className="fn-wx-stat-lbl">💨 ลม</div>
                  <div className="fn-wx-stat-val">
                    {latestWx.ws} m/s {latestWx.wd}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '10px 0', textAlign: 'center', fontSize: '10px', color: '#8896a7' }}>
              ⟳ กำลังโหลด...
            </div>
          )}

          {/* Resources */}
          <div className="fn-sec" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="fn-sec-title">ทรัพยากรภาคสนาม</div>
          </div>
          <div className="fn-res-wrap">
            <div className="fn-res-row">
              <div className="fn-res-lbl">
                <span className="fn-res-lbl-icon">🚤</span>เรือพร้อมใช้
              </div>
              <div className="fn-res-val" style={{ color: '#00d4aa' }}>
                4/6
              </div>
            </div>
            <div className="fn-res-row">
              <div className="fn-res-lbl">
                <span className="fn-res-lbl-icon">👥</span>ทีมกู้ภัย
              </div>
              <div className="fn-res-val">3 ทีม</div>
            </div>
            <div className="fn-res-row">
              <div className="fn-res-lbl">
                <span className="fn-res-lbl-icon">🆘</span>รอช่วยเหลือ
              </div>
              <div className="fn-res-val" style={{ color: '#f59e0b' }}>
                124 คน
              </div>
            </div>
          </div>

          {/* Decision Log */}
          <div className="fn-sec" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="fn-sec-title">④ Decision Log</div>
          </div>
          <div className="fn-log-wrap">
            {logEntries.map((e, i) => (
              <div key={i} className={`fn-log-entry ${e.warn ? 'fn-log-warn' : ''}`}>
                <div className="fn-log-top">
                  <div className="fn-log-route">{e.route}</div>
                  <div className="fn-log-time">{e.time}</div>
                </div>
                <div className="fn-log-reason">{e.reason}</div>
                <div className="fn-log-officer">By: {e.officer}</div>
              </div>
            ))}
          </div>
        </aside>

        {/* MAP */}
        <div className="fn-map-area">
          <div className="fn-map-ts">SAR pass: {clock} · Sentinel-1A · GISTDA Sphere</div>
          <div ref={mapRef} className="fn-map-container"></div>
          <div className="fn-map-legend">
            <div className="fn-legend-title">Legend</div>
            <div className="fn-legend-row">
              <div className="fn-lc" style={{ background: 'rgba(239,68,68,0.45)', border: '1px solid #ef4444' }}></div>
              Critical &gt;1.0m
            </div>
            <div className="fn-legend-row">
              <div className="fn-lc" style={{ background: 'rgba(245,158,11,0.35)', border: '1px solid #f59e0b' }}></div>
              High 0.5–1.0m
            </div>
            <div className="fn-legend-row">
              <div className="fn-lc" style={{ background: 'rgba(59,130,246,0.3)', border: '1px solid #3b82f6' }}></div>
              Moderate &lt;0.5m
            </div>
            <hr className="fn-legend-sep" />
            <div className="fn-legend-row">
              <div className="fn-lr-a"></div>Route A
            </div>
            <div className="fn-legend-row">
              <div className="fn-lr-b"></div>Route B
            </div>
            <div className="fn-legend-row">
              <div className="fn-lr-c"></div>Route C
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR — CHAT */}
        <aside className="fn-sidebar-right">
          <div className="fn-chat-header">
            <div className="fn-chat-hdr-top">
              <div className="fn-chat-avatar">🤖</div>
              <div className="fn-chat-title">③ FloodNav AI</div>
              <div className="fn-chat-online">
                <div className="fn-chat-online-dot"></div>Online
              </div>
            </div>
            <div className="fn-chat-sub">XAI route advisor · เชียงใหม่</div>
          </div>
          <div className="fn-chat-thread" ref={chatThreadRef}>
            {chatMessages.map((msg, i) => (
              <div key={i} className={`fn-msg fn-msg-${msg.role}`}>
                {msg.html ? (
                  <div className="fn-msg-bubble" dangerouslySetInnerHTML={{ __html: msg.html }}></div>
                ) : (
                  <div className="fn-msg-bubble">{msg.text}</div>
                )}
                <div className="fn-msg-time">{msg.time}</div>
              </div>
            ))}
          </div>
          <div className="fn-chips-wrap">
            {['สภาพอากาศตอนนี้?', 'ผู้รอช่วยกี่คน?', 'ถ้าไปเส้น B?'].map((chip) => (
              <button key={chip} className="fn-chip-btn" onClick={() => handleChipClick(chip)}>
                {chip}
              </button>
            ))}
          </div>
          <div className="fn-chat-input-row">
            <input
              className="fn-chat-in"
              placeholder="ถามเกี่ยวกับเส้นทาง / อากาศ…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendChat()}
            />
            <button className="fn-chat-send" onClick={sendChat}>
              ส่ง
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
