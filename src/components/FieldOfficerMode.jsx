import { useState, useEffect, useCallback, useRef } from 'react';
import { getAiBriefing, } from '../services/vehicleApi';
import { getWaterLevels, getTmdWarnings } from '../services/externalApi';
import '../styles/FieldOfficerMode.css';

// Passability logic — mirrored from MissionMode.jsx
function getPassability(route) {
  const riskScore = route?.risk || 0;
  const isBlocked = route?.blocked || false;
  if (isBlocked) {
    return { status: '✗ ท่วม/ปิดทาง', icon: '⛔', color: 'var(--danger)', reason: 'มีจุดรายงานถนนขาด/สิ่งกีดขวาง' };
  } else if (riskScore > 70) {
    return { status: '✗ เสี่ยงสูง (เฉพาะรถกู้ภัย)', icon: '🛥️', color: 'var(--danger)', reason: `AI ประเมินความเสี่ยง ${Math.round(riskScore)}%` };
  } else if (riskScore > 40) {
    return { status: '✓ ผ่านได้ (รถยกสูง)', icon: '🛻', color: 'var(--warn)', reason: `ความเสี่ยงปานกลาง ${Math.round(riskScore)}%` };
  }
  return { status: '✓ ผ่านได้ (ปลอดภัย)', icon: '🚙', color: 'var(--safe)', reason: `ความเสี่ยงต่ำ ${Math.round(riskScore)}%` };
}

function getRiskColor(risk) {
  if (risk > 70) return 'var(--danger)';
  if (risk > 40) return 'var(--warn)';
  return 'var(--safe)';
}

const MOCK_TEAM = [
  { id: 1, name: 'สมชาย ใจดี', role: 'หัวหน้าทีม', lat: 19.912, lon: 99.835, status: 'active', updatedAt: '2 นาทีที่แล้ว' },
  { id: 2, name: 'วิทยา บุญมา', role: 'อปพร.', lat: 19.905, lon: 99.840, status: 'active', updatedAt: '5 นาทีที่แล้ว' },
  { id: 3, name: 'สมหญิง รักดี', role: 'อปพร.', lat: 19.920, lon: 99.828, status: 'offline', updatedAt: '32 นาทีที่แล้ว' },
  { id: 4, name: 'อนุชา ทองคำ', role: 'อปพร.', lat: 19.898, lon: 99.842, status: 'active', updatedAt: '1 นาทีที่แล้ว' },
];

export default function FieldOfficerMode({
  onClose,
  routes = [],
  selectedProvince = 'เชียงราย',
  waterLevels = [],
  shelters = [],
  decisionLogs = [],
}) {
  const [activeTab, setActiveTab] = useState(null);
  const [quickDismissed, setQuickDismissed] = useState(false);

  // นำทาง
  const [activeRouteId, setActiveRouteId] = useState(routes[0]?.id || null);
  const [confirmed, setConfirmed] = useState(false);

  // รายงาน
  const [reportType, setReportType] = useState(null);
  const [severity, setSeverity] = useState(null);
  const [note, setNote] = useState('');
  const [gpsCoord, setGpsCoord] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // ทีม
  const [teamLocations, setTeamLocations] = useState(MOCK_TEAM);
  const [teamUpdatedAt, setTeamUpdatedAt] = useState(new Date().toLocaleTimeString('th-TH'));
  const [teamLoading, setTeamLoading] = useState(false);

  // Briefing
  const [briefingText, setBriefingText] = useState('');
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingWarnings, setBriefingWarnings] = useState([]);
  const [briefingLevels, setBriefingLevels] = useState([]);

  // best route = lowest risk non-blocked
  const sortedRoutes = [...routes].sort((a, b) => {
    if (a.blocked && !b.blocked) return 1;
    if (!a.blocked && b.blocked) return -1;
    return (a.risk || 0) - (b.risk || 0);
  });
  const bestRoute = sortedRoutes[0] || null;
  const activeRoute = routes.find(r => r.id === activeRouteId) || bestRoute;

  // GPS
  const getGPS = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setGpsCoord({ lat: pos.coords.latitude.toFixed(5), lon: pos.coords.longitude.toFixed(5) }),
      () => setGpsCoord({ lat: '19.90800', lon: '99.83200' }) // fallback to Chiang Rai
    );
  }, []);

  useEffect(() => {
    getGPS();
  }, [getGPS]);

  // Auto-select best route
  useEffect(() => {
    if (bestRoute && !activeRouteId) setActiveRouteId(bestRoute.id);
  }, [bestRoute, activeRouteId]);

  const fetchTeamLocations = useCallback(async () => {
    setTeamLoading(true);
    try {
      const res = await fetch('/api/team-locations');
      const data = await res.json();
      if (data.members) setTeamLocations(data.members);
    } catch {
      // keep mock data on error
    } finally {
      setTeamLoading(false);
      setTeamUpdatedAt(new Date().toLocaleTimeString('th-TH'));
    }
  }, []);

  const fetchBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const [briefing, warnings, levels] = await Promise.allSettled([
        getAiBriefing(selectedProvince),
        getTmdWarnings(selectedProvince),
        getWaterLevels(selectedProvince),
      ]);
      if (briefing.status === 'fulfilled') setBriefingText(briefing.value?.text || briefing.value || '');
      if (warnings.status === 'fulfilled') setBriefingWarnings(warnings.value?.slice(0, 3) || []);
      if (levels.status === 'fulfilled') setBriefingLevels((levels.value || []).slice(0, 4));
    } catch {
      // ignore
    } finally {
      setBriefingLoading(false);
    }
  }, [selectedProvince]);

  // Load briefing when tab opens
  useEffect(() => {
    if (activeTab === 'briefing' && !briefingText && !briefingLoading) {
      fetchBriefing();
    }
  }, [activeTab, briefingText, briefingLoading, fetchBriefing]);

  // Load team when tab opens
  useEffect(() => {
    if (activeTab === 'team') {
      fetchTeamLocations();
      const interval = setInterval(fetchTeamLocations, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchTeamLocations]);

  const handleConfirmRoute = () => {
    if (!activeRoute) return;
    setConfirmed(true);
    fetch('/api/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route: activeRoute.name || activeRoute.id,
        reason: `[เจ้าหน้าที่] ยืนยันเส้นทาง — ${activeRoute.name || activeRoute.id}`,
        officer: 'อปพร.',
      }),
    }).catch(() => {});
  };

  const handleSubmitReport = async () => {
    if (!reportType) return;
    setSubmitting(true);
    try {
      await fetch('/api/field-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: reportType,
          severity: severity || 'medium',
          note,
          lat: gpsCoord?.lat,
          lon: gpsCoord?.lon,
          province: selectedProvince,
          timestamp: new Date().toISOString(),
        }),
      });
      setSubmitSuccess(true);
      setTimeout(() => {
        setSubmitSuccess(false);
        setReportType(null);
        setSeverity(null);
        setNote('');
        setActiveTab(null);
      }, 2000);
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const passability = activeRoute ? getPassability(activeRoute) : null;

  const TABS = [
    { id: 'nav', icon: '🗺️', label: 'นำทาง' },
    { id: 'report', icon: '📋', label: 'รายงาน' },
    { id: 'team', icon: '👥', label: 'ทีม' },
    { id: 'briefing', icon: '📢', label: 'Briefing' },
  ];

  const REPORT_TYPES = [
    { id: 'flood', icon: '🌊', label: 'น้ำท่วมถนน' },
    { id: 'blocked', icon: '🚧', label: 'ถนนถูกปิด' },
    { id: 'victim', icon: '🆘', label: 'พบผู้ประสบภัย' },
  ];

  return (
    <div className="fo-overlay">

      {/* Header */}
      <div className="fo-header">
        <div className="fo-header-brand">
          <span className="fo-header-badge">อปพร.</span>
          <span className="fo-header-title">FloodNav</span>
          <span className="fo-header-subtitle">จ.{selectedProvince}</span>
        </div>
        <button className="fo-close-btn" onClick={onClose}>✕ ออก</button>
      </div>

      {/* Map area — simple embedded Sphere-like container */}
      <div className="fo-map-area">
        <FieldMap routes={routes} activeRouteId={activeRouteId} teamLocations={activeTab === 'team' ? teamLocations : []} />

        {/* Floating Quick Status Card */}
        {bestRoute && !quickDismissed && (
          <div className={`fo-quick-card${quickDismissed ? ' dismissed' : ''}`}>
            <div className="fo-quick-left">
              <span className="fo-quick-route-name">{bestRoute.name || `เส้นทาง ${bestRoute.id}`}</span>
              <span className="fo-quick-status" style={{ color: passability?.color }}>
                {passability?.icon} {passability?.status}
              </span>
              <div className="fo-quick-risk-bar">
                <div
                  className="fo-quick-risk-fill"
                  style={{
                    width: `${Math.min(100, bestRoute.risk || 0)}%`,
                    background: getRiskColor(bestRoute.risk || 0),
                  }}
                />
              </div>
            </div>
            <button className="fo-quick-nav-btn" onClick={() => setActiveTab('nav')}>
              📍 เส้นทาง
            </button>
            <button className="fo-quick-dismiss" onClick={() => setQuickDismissed(true)}>×</button>
          </div>
        )}
      </div>

      {/* Bottom Sheet Backdrop */}
      {activeTab && (
        <div className="fo-sheet-backdrop" onClick={() => setActiveTab(null)} />
      )}

      {/* Bottom Sheet */}
      {activeTab && (
        <div className="fo-sheet">
          <div className="fo-sheet-handle">
            <div className="fo-sheet-handle-bar" />
            <span className="fo-sheet-title">
              {TABS.find(t => t.id === activeTab)?.icon}{' '}
              {TABS.find(t => t.id === activeTab)?.label}
            </span>
            <button className="fo-sheet-close" onClick={() => setActiveTab(null)}>×</button>
          </div>

          <div className="fo-sheet-body">

            {/* ── Tab: นำทาง ── */}
            {activeTab === 'nav' && (
              <div>
                {sortedRoutes.length === 0 && (
                  <p className="fo-no-data">ยังไม่มีข้อมูลเส้นทาง</p>
                )}

                {sortedRoutes.slice(0, 1).map(route => {
                  const p = getPassability(route);
                  const isActive = route.id === activeRouteId;
                  return (
                    <div
                      key={route.id}
                      className={`fo-best-route-card${isActive ? ' active' : ''}`}
                      onClick={() => setActiveRouteId(route.id)}
                    >
                      <div className="fo-route-card-header">
                        <span className="fo-route-name">
                          {isActive ? '★ ' : ''}{route.name || `เส้นทาง ${route.id}`}
                        </span>
                        <span
                          className="fo-route-status-badge"
                          style={{ background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}55` }}
                        >
                          {route.risk != null ? `${Math.round(route.risk)}%` : '—'}
                        </span>
                      </div>

                      <div className="fo-route-meta">
                        <span>📏 {route.distance_km != null ? `${route.distance_km.toFixed(1)} km` : route.distanceKm != null ? `${route.distanceKm.toFixed(1)} km` : '—'}</span>
                        <span>⏱ {route.duration_min != null ? `${Math.round(route.duration_min)} นาที` : route.durationMin != null ? `${Math.round(route.durationMin)} นาที` : '—'}</span>
                        {route.depth != null && <span>💧 {route.depth.toFixed(2)} m</span>}
                      </div>

                      <div className="fo-risk-bar">
                        <div
                          className="fo-risk-fill"
                          style={{ width: `${Math.min(100, route.risk || 0)}%`, background: p.color }}
                        />
                      </div>

                      <div className="fo-passability-row" style={{ color: p.color }}>
                        {p.icon} {p.status}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{p.reason}</div>
                    </div>
                  );
                })}

                {sortedRoutes.length > 1 && (
                  <>
                    <div className="fo-alt-routes-label">เส้นทางสำรอง</div>
                    {sortedRoutes.slice(1).map(route => {
                      const p = getPassability(route);
                      const isActive = route.id === activeRouteId;
                      return (
                        <div
                          key={route.id}
                          className={`fo-alt-route-card${isActive ? ' active' : ''}`}
                          onClick={() => setActiveRouteId(route.id)}
                        >
                          <div className="fo-alt-left">
                            <span className="fo-alt-name">{route.name || `เส้นทาง ${route.id}`}</span>
                            <span className="fo-alt-sub">{p.icon} {p.status}</span>
                          </div>
                          <span className="fo-alt-risk" style={{ color: p.color }}>
                            {route.risk != null ? `${Math.round(route.risk)}%` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}

                {!confirmed ? (
                  <button className="fo-confirm-btn" onClick={handleConfirmRoute} disabled={!activeRoute}>
                    ✓ ยืนยันใช้เส้นทางนี้
                  </button>
                ) : (
                  <div className="fo-confirmed-badge">✓ บันทึกการเลือกเส้นทางแล้ว</div>
                )}
              </div>
            )}

            {/* ── Tab: รายงาน ── */}
            {activeTab === 'report' && (
              <div>
                {submitSuccess ? (
                  <div className="fo-success-msg">✓ ส่งรายงานสำเร็จ</div>
                ) : (
                  <>
                    <label className="fo-field-label">ประเภทเหตุการณ์</label>
                    <div className="fo-report-type-grid">
                      {REPORT_TYPES.map(t => (
                        <button
                          key={t.id}
                          className={`fo-type-btn${reportType === t.id ? ' selected' : ''}`}
                          onClick={() => setReportType(t.id)}
                        >
                          <span className="fo-type-icon">{t.icon}</span>
                          <span className="fo-type-label">{t.label}</span>
                        </button>
                      ))}
                    </div>

                    <label className="fo-field-label">ความรุนแรง</label>
                    <div className="fo-severity-row">
                      {[
                        { id: 'low', label: 'เบา', cls: 'sel-low' },
                        { id: 'medium', label: 'ปานกลาง', cls: 'sel-med' },
                        { id: 'high', label: 'รุนแรง', cls: 'sel-high' },
                      ].map(s => (
                        <button
                          key={s.id}
                          className={`fo-severity-btn${severity === s.id ? ` ${s.cls}` : ''}`}
                          onClick={() => setSeverity(s.id)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>

                    <label className="fo-field-label">ตำแหน่ง</label>
                    <div className="fo-location-row">
                      <span className="fo-location-text">
                        {gpsCoord
                          ? `${gpsCoord.lat}, ${gpsCoord.lon}`
                          : 'กำลังระบุตำแหน่ง...'}
                      </span>
                      <span className="fo-location-gps" onClick={getGPS}>🔄 GPS</span>
                    </div>

                    <label className="fo-field-label">หมายเหตุ (ไม่บังคับ)</label>
                    <textarea
                      className="fo-note-input"
                      rows={3}
                      placeholder="รายละเอียดเพิ่มเติม เช่น ระดับน้ำ, จำนวนผู้ติดอยู่..."
                      value={note}
                      onChange={e => setNote(e.target.value)}
                    />

                    <button
                      className="fo-submit-btn"
                      onClick={handleSubmitReport}
                      disabled={!reportType || submitting}
                    >
                      {submitting ? '⏳ กำลังส่ง...' : '📤 ส่งรายงาน'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── Tab: ทีม ── */}
            {activeTab === 'team' && (
              <div>
                <button className="fo-refresh-btn" onClick={fetchTeamLocations} disabled={teamLoading}>
                  {teamLoading ? '⏳ กำลังโหลด...' : '🔄 รีเฟรช'}
                </button>
                <div className="fo-team-list">
                  {teamLocations.map(m => (
                    <div key={m.id} className="fo-team-member">
                      <div className="fo-member-avatar">👤</div>
                      <div className="fo-member-info">
                        <div className="fo-member-name">{m.name}</div>
                        <div className="fo-member-loc">
                          {m.role} · {m.lat?.toFixed ? `${m.lat.toFixed(4)}, ${m.lon.toFixed(4)}` : m.location || '—'}
                        </div>
                        <div style={{ fontSize: 10, color: '#475569' }}>อัปเดต: {m.updatedAt}</div>
                      </div>
                      <span className={`fo-member-status ${m.status}`}>
                        {m.status === 'active' ? 'ออนไลน์' : 'ออฟไลน์'}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="fo-team-updated">ข้อมูล ณ {teamUpdatedAt}</div>
              </div>
            )}

            {/* ── Tab: Briefing ── */}
            {activeTab === 'briefing' && (
              <div>
                <button className="fo-refresh-btn" onClick={fetchBriefing} disabled={briefingLoading}>
                  {briefingLoading ? '⏳ กำลังโหลด...' : '🔄 อัปเดต Briefing'}
                </button>

                <div className="fo-briefing-section">
                  <div className="fo-briefing-section-title">📢 สรุปสถานการณ์ AI</div>
                  {briefingLoading ? (
                    <div className="fo-no-data">กำลังโหลด...</div>
                  ) : briefingText ? (
                    <div className="fo-briefing-text">{briefingText}</div>
                  ) : (
                    <div className="fo-no-data">ไม่มีข้อมูล Briefing</div>
                  )}
                </div>

                {briefingLevels.length > 0 && (
                  <div className="fo-briefing-section">
                    <div className="fo-briefing-section-title">💧 ระดับน้ำสถานีใกล้เคียง</div>
                    {briefingLevels.map((s, i) => (
                      <div key={i} className="fo-water-level-row">
                        <span className="fo-water-name">{s.name || s.station_name || `สถานี ${i + 1}`}</span>
                        <span
                          className="fo-water-val"
                          style={{ color: s.status === 'danger' ? 'var(--danger)' : s.status === 'warning' ? 'var(--warn)' : 'var(--safe)' }}
                        >
                          {s.current_level != null ? `${s.current_level} m` : s.level != null ? `${s.level} m` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {briefingWarnings.length > 0 && (
                  <div className="fo-briefing-section">
                    <div className="fo-briefing-section-title">⚠️ คำเตือนจาก TMD</div>
                    {briefingWarnings.map((w, i) => (
                      <div key={i} className="fo-warning-row">
                        <span className="fo-warning-icon">⚠️</span>
                        <span className="fo-warning-text">{w.message || w.text || w.description || JSON.stringify(w)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {!briefingLoading && !briefingText && briefingLevels.length === 0 && briefingWarnings.length === 0 && (
                  <div className="fo-no-data">กดปุ่มอัปเดต Briefing เพื่อโหลดข้อมูล</div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div className="fo-bottom-nav">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`fo-nav-btn${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(activeTab === tab.id ? null : tab.id)}
          >
            <span className="fo-nav-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

    </div>
  );
}

// Normalize coords — handles [[lon,lat]], [{lat,lon}], and GeoJSON geometry objects
function normalizeCoords(raw) {
  if (!raw) return [];
  // GeoJSON geometry object
  const arr = raw.coordinates ?? raw;
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const first = arr[0];
  if (Array.isArray(first) && first.length >= 2) {
    // [[lon, lat], ...] — swap to [lat, lon] for Leaflet
    return arr.map(c => [c[1], c[0]]);
  }
  if (first && typeof first === 'object') {
    // [{lat, lon}, ...] or [{latitude, longitude}, ...]
    return arr.map(c => [c.lat ?? c.latitude ?? 0, c.lon ?? c.lng ?? c.longitude ?? 0]);
  }
  return [];
}

// Simple Leaflet map for field officer
function FieldMap({ routes, activeRouteId, teamLocations }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({ routes: {}, teams: {} });

  const drawLayers = useCallback((L, map) => {
    const layers = layersRef.current;

    // Clear routes
    Object.values(layers.routes).forEach(l => { try { map.removeLayer(l); } catch (_) {} });
    layers.routes = {};

    let activeBounds = null;
    routes.forEach(route => {
      const latlngs = normalizeCoords(route.points || route.geometry);
      if (latlngs.length < 2) return;
      const isActive = route.id === activeRouteId;
      const risk = route.risk || 0;
      const color = risk > 70 ? '#ef4444' : risk > 40 ? '#f59e0b' : '#22c55e';
      const polyline = L.polyline(latlngs, {
        color,
        weight: isActive ? 6 : 3,
        opacity: isActive ? 1 : 0.5,
        dashArray: route.blocked ? '8 6' : undefined,
      }).addTo(map);
      polyline.bindPopup(`${route.name || route.id} — ความเสี่ยง ${Math.round(risk)}%`);
      layers.routes[route.id] = polyline;
      if (isActive) activeBounds = polyline.getBounds();
    });

    if (activeBounds) {
      try { map.fitBounds(activeBounds, { padding: [40, 40] }); } catch (_) {}
    }

    // Clear team markers
    Object.values(layers.teams).forEach(l => { try { map.removeLayer(l); } catch (_) {} });
    layers.teams = {};

    teamLocations.forEach(m => {
      if (!m.lat || !m.lon) return;
      const icon = L.divIcon({
        html: `<div style="background:${m.status === 'active' ? '#22c55e' : '#475569'};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`,
        iconSize: [12, 12],
        className: '',
      });
      const marker = L.marker([m.lat, m.lon], { icon })
        .addTo(map)
        .bindPopup(`${m.name} (${m.status === 'active' ? 'ออนไลน์' : 'ออฟไลน์'})`);
      layers.teams[m.id] = marker;
    });
  }, [routes, activeRouteId, teamLocations]);

  // Init map once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let mounted = true;

    const init = async () => {
      if (!document.getElementById('fo-leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'fo-leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      if (!window.L) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      if (!mounted || mapRef.current) return;

      // Clear any stale Leaflet state from StrictMode double-invoke
      if (container._leaflet_id) delete container._leaflet_id;

      const map = window.L.map(container, { zoomControl: false }).setView([19.908, 99.832], 11);
      mapRef.current = map;

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM', maxZoom: 18,
      }).addTo(map);
      window.L.control.zoom({ position: 'topright' }).addTo(map);
      drawLayers(window.L, map);
    };

    init().catch(() => {});

    return () => {
      mounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layersRef.current = { routes: {}, teams: {} };
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update layers when props change after init
  useEffect(() => {
    if (!mapRef.current || !window.L) return;
    drawLayers(window.L, mapRef.current);
  }, [drawLayers]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#1e293b' }} />;
}
