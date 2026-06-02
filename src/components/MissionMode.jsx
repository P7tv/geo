import { useState, useEffect } from 'react';
import RadarChart from './RadarChart';
import XAIWaterfallChart from './XAIWaterfallChart';
import DecisionFlowchart from './DecisionFlowchart';

export default function MissionMode({
  onClose,
  routes,
  activeRouteId,
  setActiveRouteId,
  simulationRainMultiplier,
  setSimulationRainMultiplier,
  tmdAlertText,
  decisionLogs,
  vehicleData,
  selectedCamera
}) {
  const [activeTab, setActiveTab] = useState('routing');
  const [yoloData, setYoloData] = useState(null);
  const [yoloLoading, setYoloLoading] = useState(false);
  const [yoloError, setYoloError] = useState(null);

  useEffect(() => {
    if (selectedCamera && selectedCamera.url) {
      setYoloLoading(true);
      setYoloData(null);
      setYoloError(null);
      fetch('/api/detect-cctv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: selectedCamera.url })
      })
      .then(r => r.json())
      .then(data => {
        if (data.status === 'success') {
          setYoloData(data);
        } else {
          setYoloError("CAMERA OFFLINE OR UNREACHABLE");
        }
      })
      .catch(err => {
        console.error("YOLO fetch error", err);
        setYoloError("CONNECTION ERROR");
      })
      .finally(() => setYoloLoading(false));
    } else {
      setYoloData(null);
      setYoloError(null);
    }
  }, [selectedCamera]);

  const activeRoute = routes.find(r => r.id === activeRouteId) || routes[0];
  
  if (!activeRoute) return null;

  // Determine passability for active route
  const isBlocked = activeRoute.blocked;
  const floodExposure = activeRoute.features?.f_flood_exposure || 0;
  
  const riskScore = activeRoute.risk || 0;
  
  let passabilityStatus, passabilityIcon, passabilityColor, reasonText;

  if (isBlocked) {
    passabilityStatus = '✗ ท่วม/ปิดทาง';
    passabilityIcon = '⛔';
    passabilityColor = 'var(--danger)';
    reasonText = 'มีจุดรายงานถนนขาด/สิ่งกีดขวางบนเส้นทาง โปรดหลีกเลี่ยงทันที';
  } else if (riskScore > 70) {
    passabilityStatus = '✗ เสี่ยงท่วมสูง (แนะนำรถเฉพาะกิจ)';
    passabilityIcon = '🛥️';
    passabilityColor = 'var(--danger)';
    reasonText = `AI ประเมินความเสี่ยงสูงถึง ${Math.round(riskScore)}% รถเล็กไม่ควรผ่าน`;
  } else if (riskScore > 40) {
    passabilityStatus = '✓ ผ่านได้ (เฉพาะรถยกสูง)';
    passabilityIcon = '🛻';
    passabilityColor = '#f59e0b';
    reasonText = `ความเสี่ยงปานกลาง (${Math.round(riskScore)}%) อาจมีน้ำท่วมขังขวางการจราจรบางจุด`;
  } else {
    passabilityStatus = '✓ ผ่านได้ (ปลอดภัย)';
    passabilityIcon = '🚙';
    passabilityColor = 'var(--safe)';
    reasonText = `ความเสี่ยงต่ำ (${Math.round(riskScore)}%) ถนนสามารถสัญจรได้ตามปกติ`;
  }

  const handleShare = () => {
    const text = `🚨 รายงานสถานการณ์เส้นทาง: ${activeRoute.name}\n` +
      `สถานะ: ${passabilityStatus}\n` +
      `ความเสี่ยง AI: ${Math.round(riskScore)}%\n` +
      `เหตุผล: ${reasonText}\n\n` +
      `[ส่งจาก FloodNav Command Center]`;
    navigator.clipboard.writeText(text).then(() => {
      alert('คัดลอกสรุปสถานการณ์ไปยังคลิปบอร์ดแล้ว นำไปวางใน LINE หรือแชททีมกู้ภัยได้เลย!');
    });
  };

  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 999,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-th)',
      pointerEvents: 'none'
    }}>
      {/* Top Banner */}
      <div style={{ 
        background: 'rgba(15, 23, 42, 0.85)', 
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        color: '#fff', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        pointerEvents: 'auto',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ 
            animation: 'pulse 2s infinite', background: 'rgba(239, 68, 68, 0.2)', 
            color: '#ef4444', padding: '6px 12px', borderRadius: 8, fontSize: 18,
            border: '1px solid rgba(239, 68, 68, 0.5)', display: 'flex', alignItems: 'center', gap: 8
          }}>
            <span>🚨</span>
            <span style={{ fontSize: 12, fontWeight: 'bold', letterSpacing: 1 }}>MISSION ACTIVE</span>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 'bold', color: 'var(--text-1)' }}>FloodNav — Command Center</h1>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>LIVE DATA • GISTDA + TMD + AI</div>
          </div>
        </div>
        <button onClick={onClose} style={{ 
          background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', 
          padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
        >
          ✕ ยุติปฏิบัติการ
        </button>
      </div>

      {/* Main Content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Panel: Summary */}
        <div className="glass-panel mission-panel" style={{ 
          height: '100%',
          background: 'rgba(30, 41, 59, 0.85)', 
          backdropFilter: 'blur(12px)',
          borderRight: '1px solid var(--border)', 
          display: 'flex', flexDirection: 'column',
          pointerEvents: 'auto',
          boxShadow: '4px 0 24px rgba(0,0,0,0.4)'
        }}>
          
          <div style={{ padding: '24px 24px 12px', flex: 1, overflowY: 'auto' }}>
            <h2 style={{ fontSize: 16, marginBottom: 16, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1 }}>
              📍 เส้นทางปฏิบัติการที่ปลอดภัยที่สุด
            </h2>
            
            {/* Active Route Big Card */}
            <div style={{ 
              background: 'var(--bg-panel)', 
              border: `2px solid ${passabilityColor}`, 
              borderRadius: 'var(--radius-lg)', 
              padding: 20, marginBottom: 24,
              boxShadow: '0 8px 16px rgba(0,0,0,0.2)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 24, margin: 0, color: 'var(--text-1)' }}>{activeRoute.name}</h3>
                <span style={{ fontSize: 36 }}>{passabilityIcon}</span>
              </div>
              
              <div style={{ fontSize: 18, fontWeight: 'bold', color: passabilityColor, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: passabilityColor, display: 'inline-block' }}></span>
                {passabilityStatus}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ background: 'var(--bg-panel-alt)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>ระยะทางรวม</div>
                  <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--text-1)' }}>{activeRoute.distanceKm ?? activeRoute.distance ?? '--'} <span style={{ fontSize: 12, fontWeight: 'normal' }}>กม.</span></div>
                </div>
                <div style={{ background: 'var(--bg-panel-alt)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>เวลาประเมิน</div>
                  <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--text-1)' }}>{Math.round(activeRoute.durationMin ?? activeRoute.duration ?? 0)} <span style={{ fontSize: 12, fontWeight: 'normal' }}>นาที</span></div>
                </div>
              </div>

              {/* XAI Reason Block */}
              <div style={{ background: 'var(--blue-dim)', borderLeft: '3px solid var(--blue-primary)', padding: 16, borderRadius: '0 8px 8px 0' }}>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)', marginBottom: 12 }}>
                  {reasonText}
                </p>
                <XAIWaterfallChart route={activeRoute} />
              </div>
            </div>

            <DecisionFlowchart route={activeRoute} />

            {/* What-If Simulation Controls */}
            {setSimulationRainMultiplier && (
              <div style={{ 
                background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 24,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}>
                <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
                  <span>🎛️ จำลองสถานการณ์ (What-If)</span>
                  <span style={{ color: 'var(--blue-primary)' }}>Rain x{simulationRainMultiplier}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 14 }}>☀️</span>
                  <input 
                    type="range" 
                    min="0" max="2" step="0.1" 
                    value={simulationRainMultiplier} 
                    onChange={e => setSimulationRainMultiplier(parseFloat(e.target.value))} 
                    style={{ flex: 1, accentColor: 'var(--blue-primary)' }}
                  />
                  <span style={{ fontSize: 14 }}>⛈️</span>
                </div>
              </div>
            )}

            {/* Other Routes Summary */}
            <h3 style={{ fontSize: 14, marginBottom: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1 }}>
              🔄 เส้นทางสำรอง
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {routes.map(r => {
                if (r.id === activeRoute.id) return null;
                const isRBlocked = r.blocked;
                const rRisk = r.risk || 0;
                
                let rStatus = '';
                let rIcon = '';
                let rColor = '';
                
                if (isRBlocked) {
                  rStatus = '✗ ท่วม/ปิดทาง'; rIcon = '⛔'; rColor = 'var(--danger)';
                } else if (rRisk > 70) {
                  rStatus = '✗ เสี่ยงท่วมสูง'; rIcon = '🛥️'; rColor = 'var(--danger)';
                } else if (rRisk > 40) {
                  rStatus = '✓ รถยกสูงผ่านได้'; rIcon = '🛻'; rColor = '#f59e0b';
                } else {
                  rStatus = '✓ ผ่านได้ปกติ'; rIcon = '🚙'; rColor = 'var(--safe)';
                }

                return (
                  <div 
                    key={r.id} 
                    onClick={() => setActiveRouteId(r.id)}
                    style={{ 
                      padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-panel)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                      transition: 'border-color 0.2s, transform 0.1s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--blue-primary)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--text-1)' }}>{r.name}</div>
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: rColor, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {rStatus}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        <span style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--text-1)' }}>
                          {Math.round(r.durationMin ?? r.duration ?? 0)}
                        </span> นาที
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {r.distanceKm ?? r.distance ?? '--'} กม.
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Radar Chart Overlay */}
            <div style={{ marginTop: 24, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
              <h3 style={{ fontSize: 13, margin: '0 0 16px 0', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
                📊 เปรียบเทียบโครงสร้างความเสี่ยง
              </h3>
              <div style={{ transform: 'scale(0.9)', transformOrigin: 'top center' }}>
                <RadarChart routes={routes} />
              </div>
            </div>

          </div>

          <div style={{ padding: 24, borderTop: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
            <button 
              onClick={handleShare}
              style={{ 
                width: '100%', padding: '14px 16px', background: '#00B900', color: '#fff', 
                border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10,
                boxShadow: '0 4px 12px rgba(0, 185, 0, 0.3)',
                transition: 'transform 0.1s'
              }}
              onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
              onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 10.5C22 5.8 17.5 2 12 2C6.5 2 2 5.8 2 10.5C2 13 3.3 15.3 5.4 16.8L4.5 19.9C4.4 20.3 4.8 20.6 5.1 20.4L8.7 18.2C9.7 18.7 10.8 19 12 19C17.5 19 22 15.2 22 10.5Z" fill="white"/>
              </svg>
              แชร์เส้นทางให้ทีมกู้ภัย
            </button>
          </div>
        </div>

        {/* Right Panel: HUD Overlay */}
        <div className="glass-panel mission-hud" style={{ 
          width: '320px', 
          height: '100%', 
          background: 'rgba(15, 23, 42, 0.75)', 
          backdropFilter: 'blur(10px)',
          borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          pointerEvents: 'auto',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
          marginLeft: 'auto'
        }}>
          <div style={{ padding: '24px 24px 12px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* CCTV Monitor */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ fontSize: 13, marginBottom: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 1, display: 'flex', justifyContent: 'space-between' }}>
                <span>📹 LIVE CCTV TELEMETRY</span>
                <span style={{ color: 'var(--danger)', animation: 'pulse 1.5s infinite' }}>● REC</span>
              </h2>
              
              <div className="cctv-monitor" style={{ 
                background: '#040b14', 
                borderRadius: '8px', 
                border: '1px solid var(--border-strong)',
                height: '180px',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '12px'
              }}>
                {selectedCamera && (
                  <img 
                    src={`/api/stream-cctv?url=${encodeURIComponent(selectedCamera.url)}`} 
                    alt="Live CCTV Feed" 
                    onError={(e) => {
                      if (e.target.src !== selectedCamera.url) {
                         e.target.src = selectedCamera.url;
                      }
                    }}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.75, zIndex: 1 }} 
                  />
                )}
                <div className="scanlines" style={{ zIndex: 3 }}></div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0f0', fontFamily: 'var(--font-mono)', fontSize: 10, zIndex: 4, textShadow: '0 0 4px #000' }}>
                  <span>{selectedCamera ? (selectedCamera.title || 'CAM_LIVE') : `CAM_01 // ROUTE_${activeRouteId}`}</span>
                  <span>{new Date().toLocaleTimeString('en-GB')}</span>
                </div>

                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4, position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {(() => {
                    const vd = vehicleData?.[activeRouteId];

                    // YOLO result — render bounding boxes from detect_cctv
                    if (yoloData?.detections?.length > 0) {
                      return yoloData.detections.map((det, idx) => {
                        const [x1, y1, x2, y2] = det.bbox;
                        const isPerson = det.class === 'person';
                        const color = isPerson ? '#3b82f6' : '#00ff00';
                        return (
                          <div key={idx} style={{
                            position: 'absolute',
                            left: `${x1 * 100}%`, top: `${y1 * 100}%`,
                            width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%`,
                            border: `1.5px solid ${color}`, zIndex: 5, pointerEvents: 'none'
                          }}>
                            <span style={{ position: 'absolute', top: -14, left: 0, color: '#fff', fontSize: 8, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', background: color, padding: '0 3px', borderRadius: '2px 2px 0 0' }}>
                              {det.class.toUpperCase()} {(det.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        );
                      });
                    }

                    if (yoloLoading) {
                      return <span style={{ color: '#0f0', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 1, animation: 'pulse 1s infinite' }}>[ RUNNING YOLOv8 ]</span>;
                    }
                    if (yoloError) {
                      return <span style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 1 }}>[ {yoloError} ]</span>;
                    }
                    if (!selectedCamera && (!vd || vd.congestion_level === 'unknown' || vd.vehicle_count === 0)) {
                      return <span style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: 14, letterSpacing: 2 }}>SIGNAL LOST</span>;
                    }
                    if (!selectedCamera) {
                      const isWarn = vd?.congestion_level === 'warning' || vd?.congestion_level === 'blocked';
                      const boxColor = isWarn ? '#f59e0b' : '#0f0';
                      return (
                        <div style={{ width: '80%', height: '60%', border: `1px solid rgba(${isWarn ? '245,158,11' : '0,255,0'}, 0.5)`, position: 'relative', animation: 'pulse 2s infinite' }}>
                          <span style={{ position: 'absolute', top: -14, left: 0, color: boxColor, fontSize: 9, fontFamily: 'var(--font-mono)', textShadow: '0 0 2px #000' }}>OBJ: VEHICLE (0.92)</span>
                          <div style={{ width: '100%', height: '100%', background: `rgba(${isWarn ? '245,158,11' : '0,255,0'}, 0.05)` }}></div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
                
                <div style={{ color: '#0f0', fontFamily: 'var(--font-mono)', fontSize: 10, zIndex: 4, display: 'flex', justifyContent: 'space-between', textShadow: '0 0 4px #000' }}>
                  <span>{yoloData ? yoloData.counts.vehicles : (vehicleData?.[activeRouteId]?.vehicle_count || 0)} VEHICLES</span>
                  {yoloData ? (
                     <span style={{ color: '#3b82f6' }}>{yoloData.counts.people} PEOPLE</span>
                  ) : (
                     <span>{vehicleData?.[activeRouteId]?.avg_speed || 0} KM/H</span>
                  )}
                </div>
              </div>
            </div>

            {/* AI Dispatch Console */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <h2 style={{ fontSize: 13, marginBottom: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                <span>⚡ AI TACTICAL DISPATCH</span>
              </h2>
              
              <div style={{ 
                background: 'rgba(2, 6, 23, 0.8)', 
                border: '1px solid var(--border)', 
                borderRadius: '8px', 
                flex: 1,
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                overflowY: 'auto',
                fontFamily: 'var(--font-mono)'
              }}>
                {(decisionLogs || []).slice(0, 8).map((log, i) => (
                  <div key={i} style={{ 
                    fontSize: 10, 
                    paddingBottom: 10, 
                    borderBottom: i < 7 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    color: log.warn ? 'var(--warn)' : 'var(--blue-primary)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, opacity: 0.7 }}>
                      <span>[{log.time}]</span>
                      <span>{log.officer}</span>
                    </div>
                    <div style={{ lineHeight: 1.4, textShadow: log.warn ? '0 0 4px var(--warn)' : 'none' }}>
                      &gt; {log.reason}
                    </div>
                  </div>
                ))}
                {(!decisionLogs || decisionLogs.length === 0) && (
                  <div style={{ color: 'var(--text-3)', fontSize: 10 }}>&gt; WAITING FOR TELEMETRY...</div>
                )}
              </div>
            </div>

          </div>
        </div>

      </div>

    </div>
  );
}
