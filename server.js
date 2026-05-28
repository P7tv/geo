/**
 * FloodNav Advanced Express API Server
 * Integrates: Supabase CCTV Traffic, Typhoon AI, TMD Weather proxy
 */

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

// Native .env file loader to populate process.env without external dependencies
try {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const index = trimmed.indexOf('=');
        if (index > -1) {
          const key = trimmed.substring(0, index).trim();
          const val = trimmed.substring(index + 1).trim();
          process.env[key] = val;
        }
      }
    });
    console.log('⚡ Loaded environment configurations from .env successfully.');
  }
} catch (e) {
  console.warn('⚠️ Native .env loader failed:', e.message);
}

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// --- CONSTANTS ---
const TRAFFIC_WINDOW_MS    = 15 * 60 * 1000;  // 15-min rolling window for CCTV
const TRAFFIC_QUERY_LIMIT  = 500;              // max Supabase rows per poll
const RAIN_SATURATION_MM   = 25;              // rainfall cap for f_rain feature
const FORECAST_DURATION    = 1;               // hours of TMD forecast to fetch

// --- API CONFIG & INITIALIZATION ---

const TMD_TOKEN = process.env.TMD_TOKEN;
if (!TMD_TOKEN) console.warn('⚠️  TMD_TOKEN missing in .env — weather API disabled');

// Supabase (CCTV detections from Jetson)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('🔋 Supabase connected');
} else {
  console.log('⚠️  SUPABASE keys missing — no live CCTV data');
}

// Typhoon AI (OpenAI-compatible)
const TYPHOON_API_KEY = process.env.TYPHOON_API_KEY;
let typhoon = null;
if (TYPHOON_API_KEY) {
  typhoon = new OpenAI({
    apiKey: TYPHOON_API_KEY,
    baseURL: 'https://api.opentyphoon.ai/v1',
  });
  console.log('🌀 Typhoon AI connected');
} else {
  console.log('⚠️  TYPHOON_API_KEY missing — AI endpoints disabled');
}

app.use(cors());
app.use(express.json());

// Camera → Route mapping (ตาม Jetson CCTV setup)
const CAMERA_ROUTE_MAP = {
  'cam_01': 'A',
  'cam_02': 'A',
  'cam_03': 'B',
  'cam_04': 'C',
};

// --- HELPERS ---

const fetchLiveWeather = async () => {
  try {
    const lat = 19.908, lon = 99.832;
    const bangkokNow = new Date(Date.now() + 7 * 3_600_000);
    const date = bangkokNow.toISOString().slice(0, 10);
    const headers = { Authorization: `Bearer ${TMD_TOKEN}`, Accept: 'application/json' };
    for (const hour of [bangkokNow.getUTCHours(), 0]) {
      try {
        const url = `https://data.tmd.go.th/nwpapi/v1/forecast/location/hourly/at` +
          `?lat=${lat}&lon=${lon}&fields=tc,rh,rain,ws10m,wd10m,cond&date=${date}&hour=${hour}&duration=${FORECAST_DURATION}`;
        const resp = await fetch(url, { headers });
        if (!resp.ok) continue;
        const json = await resp.json().catch(() => null);
        const data = json?.WeatherForecasts?.[0]?.forecasts?.[0]?.data;
        if (data) return data;
      } catch { continue; }
    }
    return null;
  } catch {
    return null;
  }
};

const weatherToString = (w) => {
  if (!w) return null;
  const dirs = ['เหนือ','ตะวันออกเฉียงเหนือ','ตะวันออก','ตะวันออกเฉียงใต้','ใต้','ตะวันตกเฉียงใต้','ตะวันตก','ตะวันตกเฉียงเหนือ'];
  const dirName = dirs[Math.round((w.wd10m ?? 0) / 45) % 8] ?? 'ไม่ระบุ';
  return `อุณหภูมิ: ${w.tc ?? '-'}°C, ฝนสะสม: ${w.rain ?? 0} mm/hr, ความชื้น: ${w.rh ?? '-'}%, ลม: ${w.ws10m ?? 0} m/s ทิศ${dirName}`;
};

const fetchLiveTraffic = async () => {
  if (!supabase) return null;
  try {
    const since = new Date(Date.now() - TRAFFIC_WINDOW_MS).toISOString();
    const { data: detections, error } = await supabase
      .from('detections')
      .select('camera_id,extra')
      .gte('timestamp', since)
      .limit(TRAFFIC_QUERY_LIMIT);
    if (error) throw error;

    const routes = {
      A: { validSpeeds: [], count: 0, stoppedCount: 0 },
      B: { validSpeeds: [], count: 0, stoppedCount: 0 },
      C: { validSpeeds: [], count: 0, stoppedCount: 0 },
    };

    detections.forEach(det => {
      const routeId = CAMERA_ROUTE_MAP[det.camera_id] ?? det.extra?.route_id;
      if (!routeId || !routes[routeId]) return;
      routes[routeId].count++;
      const speed = typeof det.extra?.speed === 'number' ? det.extra.speed : null;
      if (speed !== null) {
        routes[routeId].validSpeeds.push(speed);
        if (speed < 5) routes[routeId].stoppedCount++;
      }
    });

    const summary = {};
    ['A', 'B', 'C'].forEach(id => {
      const r = routes[id];
      const speedCount = r.validSpeeds.length;
      const avg_speed = speedCount > 0
        ? parseFloat((r.validSpeeds.reduce((a, b) => a + b, 0) / speedCount).toFixed(1))
        : 0;
      const stopped_ratio = r.count > 0
        ? parseFloat((r.stoppedCount / r.count).toFixed(2))
        : 0;
      let congestion_level = 'normal';
      if (stopped_ratio > 0.5) congestion_level = 'blocked';
      else if (speedCount > 0 && avg_speed < 20) congestion_level = 'warning';
      summary[id] = { vehicle_count: r.count, avg_speed, congestion_level, stopped_ratio };
    });
    return summary;
  } catch (err) {
    console.error('Supabase traffic error:', err.message);
    return null;
  }
};


// ── ML Risk Model ─────────────────────────────────────────────────────────────
// Risk Score formula per proposal (GeoAI Final Proposal):
//   RiskScore = (0.45 × FloodExposure) + (0.25 × ForecastRain) + (0.20 × HistoricalIncident) + (0.10 × SoilRisk)
//
// Feature sources:
//   FloodExposure     — fraction of route intersecting current GISTDA flood polygons
//   ForecastRain      — TMD NWP hourly rainfall intensity normalized by saturation threshold (25 mm/hr)
//   HistoricalIncident— area-weighted GISTDA flood-freq patches (2011-2024) per route bbox
//   SoilRisk          — LDD PiP soil drainage risk (40%) + Open-Meteo 72h rainfall saturation (60%)

// Fallback: static flood frequency [0-1] used when GISTDA Sphere API is unavailable
// Static fallback เมื่อ GISTDA flood-freq API ไม่ตอบ
const CR_HISTORICAL_INCIDENTS = {
  'เวียงป่าเป้า': 0.88,
  'แม่สาย':      0.78,
  'เทิง':        0.62,
  'เมือง':       0.52,
};

// bbox ต่อ route สำหรับ query GISTDA /features/flood-freq (xmin,ymin,xmax,ymax)
const ROUTE_BBOX = {
  A: [99.820, 19.900, 99.895, 20.450],  // ทล.1 เมือง→แม่สาย
  B: [99.820, 19.895, 100.085, 19.990], // ทล.1020 เมือง→เทิง
  C: [99.820, 19.360, 99.870, 19.920],  // ทล.118 เมือง→เวียงป่าเป้า
};

// Cache: flood-freq polygon ต่อ route — refresh ทุก 24h (ข้อมูลรายปี)
const floodFreqFeatCache = { A: null, B: null, C: null, ts: 0, lastStatus: 'offline' };
const FLOOD_FREQ_FEAT_TTL = 24 * 60 * 60_000;

const fetchFloodFreqFeatures = async (routeId) => {
  if (floodFreqFeatCache[routeId] && Date.now() - floodFreqFeatCache.ts < FLOOD_FREQ_FEAT_TTL) {
    floodFreqFeatCache.lastStatus = 'cached';
    return floodFreqFeatCache[routeId];
  }
  try {
    const dataKey = process.env.VITE_GISTDA_DATA_KEY;
    const bbox = ROUTE_BBOX[routeId].join(',');
    const url = `https://api-gateway.gistda.or.th/api/2.0/resources/features/flood-freq` +
      `?bbox=${bbox}&pv_idn=57&limit=1000`;
    const r = await fetchWithTimeout(url, { headers: { 'API-Key': dataKey } }, 12000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const feats = j.features ?? [];
    floodFreqFeatCache[routeId] = feats;
    floodFreqFeatCache.ts = Date.now();
    floodFreqFeatCache.lastStatus = 'live';
    console.log(`📊 flood-freq Route ${routeId}: ${feats.length}/${j.numberMatched ?? '?'} polygons`);
    return feats;
  } catch (e) {
    console.warn(`fetchFloodFreqFeatures ${routeId}:`, e.message);
    if (floodFreqFeatCache.lastStatus !== 'live')
      floodFreqFeatCache.lastStatus = floodFreqFeatCache[routeId] ? 'cached' : 'fallback';
    return floodFreqFeatCache[routeId] ?? [];
  }
};

// คำนวณ f_historical จาก area-weighted avg ของ freq/14 ทุก patch ใน route bbox
// flood-freq feature = patch น้ำท่วมจริง (เล็กมาก) bbox กรอง corridor ของ route แล้ว
const FLOOD_FREQ_YEARS = 14; // 2011-2024
const computeHistoricalRisk = (_routePoints, freqFeatures) => {
  if (!freqFeatures?.length) return null;
  let totalArea = 0, weightedFreq = 0;
  for (const f of freqFeatures) {
    const area = f.properties.area_rai ?? 1;
    const freq = (f.properties.freq ?? 0) / FLOOD_FREQ_YEARS;
    totalArea += area;
    weightedFreq += freq * area;
  }
  return totalArea > 0 ? +(weightedFreq / totalArea).toFixed(3) : null;
};

// wrapper ที่ยังใช้ชื่อ fetchFloodFreq เพื่อไม่ต้องแก้ call site เดิม
const fetchFloodFreq = async () => ({});  // ไม่ใช้แล้ว → per-route ใน flood-routes endpoint

// LDD soil polygons — loaded from data/soil_polygons.json (pre-processed once by export_soil_polygons.py)
// Each entry: { risk, bbox:[minLon,minLat,maxLon,maxLat], ring:[[lon,lat],...], holes:[[[lon,lat],...]] }
let SOIL_POLYGONS = [];
try {
  const soilJson = JSON.parse(fs.readFileSync(path.resolve('data/soil_polygons.json'), 'utf8'));
  SOIL_POLYGONS = (soilJson.polygons ?? []).map(p => ({
    risk:  p.risk,
    bbox:  p.bbox,
    ring:  p.coords,         // exterior ring — GeoJSON [lon, lat] order
    holes: p.holes ?? [],    // interior rings (4.2% of parts) — same order
  }));
  console.log(`🌱 Soil polygons loaded: ${SOIL_POLYGONS.length} rings (LDD จ.เชียงราย)`);
} catch {
  console.warn('⚠ data/soil_polygons.json not found — f_soil will use fallback 0.50');
}

// Point-sample route → average soil risk using PiP with bbox pre-filter
const computeRouteSoilRisk = (routePoints) => {
  if (!SOIL_POLYGONS.length) return null;
  // Sample every Nth point to keep latency low (route A has 509 pts → sample 52)
  const step = Math.max(1, Math.floor(routePoints.length / 50));
  const sampled = routePoints.filter((_, i) => i % step === 0);
  const risks = [];
  for (const pt of sampled) {
    const candidates = SOIL_POLYGONS.filter(p =>
      pt.lon >= p.bbox[0] && pt.lon <= p.bbox[2] &&
      pt.lat >= p.bbox[1] && pt.lat <= p.bbox[3]
    );
    for (const poly of candidates) {
      if (pipRing(pt.lat, pt.lon, poly.ring)) {
        // Exclude point if it falls inside a hole (interior ring)
        const inHole = poly.holes.some(h => pipRing(pt.lat, pt.lon, h));
        if (!inHole) { risks.push(poly.risk); }
        break;
      }
    }
  }
  return risks.length ? +(risks.reduce((a, b) => a + b, 0) / risks.length).toFixed(3) : null;
};

// Representative midpoint coordinates for Open-Meteo 72h rainfall query per route
const ROUTE_MIDPOINTS = {
  A: { lat: 20.171, lon: 99.857 },  // ทล.1 เมือง→แม่สาย
  B: { lat: 19.943, lon: 99.953 },  // ทล.1020 เมือง→เทิง
  C: { lat: 19.642, lon: 99.845 },  // ทล.118 เมือง→เวียงป่าเป้า
};

const RAIN72H_SAT_MM = 150.0;  // mm/72h ที่ทำให้ดินอิ่มน้ำเต็มที่

// Cache: rain72h ต่อ route — refresh ทุก 1 ชั่วโมง
const rain72hCache = { data: {}, ts: 0, lastStatus: 'offline' };

const fetchRain72h = async () => {
  if (Date.now() - rain72hCache.ts < 60 * 60 * 1000) {
    rain72hCache.lastStatus = 'cached';
    return rain72hCache.data;
  }
  try {
    const results = await Promise.allSettled(
      Object.entries(ROUTE_MIDPOINTS).map(async ([id, { lat, lon }]) => {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&hourly=precipitation&past_days=3&forecast_days=0&timezone=Asia%2FBangkok`;
        const r = await fetch(url, { timeout: 8000 });
        const j = await r.json();
        const rain72h = (j.hourly?.precipitation ?? []).slice(-72)
          .reduce((s, v) => s + (v ?? 0), 0);
        return [id, +rain72h.toFixed(1)];
      })
    );
    const data = {};
    for (const r of results) {
      if (r.status === 'fulfilled') data[r.value[0]] = r.value[1];
    }
    rain72hCache.data = data;
    rain72hCache.ts   = Date.now();
    rain72hCache.lastStatus = Object.keys(data).length ? 'live' : 'fallback';
    console.log('🌧  Rain 72h (mm):', data);
    return data;
  } catch (e) {
    console.warn('rain72h fetch failed:', e.message);
    rain72hCache.lastStatus = Object.keys(rain72hCache.data).length ? 'cached' : 'fallback';
    return rain72hCache.data;
  }
};

// Route → primary district mapping for HistoricalIncident lookup
const ROUTE_DISTRICT = { A: 'แม่สาย', B: 'เทิง', C: 'เวียงป่าเป้า' };

const sigmoid = x => 1 / (1 + Math.exp(-x));

/**
 * Compute flood risk score [0–99] for a single route.
 * Returns { risk, depth_est, confidence, features }
 */

// ── Point-in-polygon (ray casting) ────────────────────────────────────────────
function pipRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // GeoJSON stores [lon, lat]
    const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function pipFeature(lat, lon, feat) {
  const g = feat?.geometry;
  if (!g) return false;
  if (g.type === 'Polygon')      return pipRing(lat, lon, g.coordinates[0]);
  if (g.type === 'MultiPolygon') return g.coordinates.some(p => pipRing(lat, lon, p[0]));
  return false;
}
// สัดส่วนจุดบนเส้นทางที่อยู่ใน flood polygon (0 = ไม่ท่วม, 1 = ท่วมทั้งสาย)
function routeFloodExposure(points, features) {
  if (!features?.length || !points?.length) return 0;
  const n = points.filter(p => features.some(f => pipFeature(p.lat, p.lon, f))).length;
  return +(n / points.length).toFixed(3);
}

// ── GISTDA current flood features — cached 15 min ────────────────────────────
let gistdaFloodCache = { data: null, ts: 0, lastStatus: 'offline' };
const GISTDA_FLOOD_TTL = 15 * 60_000;
const fetchGistdaCurrentFlood = async () => {
  if (gistdaFloodCache.data !== null && Date.now() - gistdaFloodCache.ts < GISTDA_FLOOD_TTL) {
    gistdaFloodCache.lastStatus = 'cached';
    return gistdaFloodCache.data;
  }
  try {
    const dataKey = process.env.VITE_GISTDA_DATA_KEY;
    const url = 'https://api-gateway.gistda.or.th/api/2.0/resources/features/flood/7days?pv_idn=57&limit=1000';
    const r = await fetchWithTimeout(url, { headers: { 'API-Key': dataKey } }, 10000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    gistdaFloodCache = { data: j.features ?? [], ts: Date.now(), lastStatus: 'live' };
    console.log(`🌊 GISTDA flood features loaded: ${gistdaFloodCache.data.length} polygons`);
    return gistdaFloodCache.data;
  } catch (e) {
    console.warn('GISTDA flood fetch error:', e.message);
    gistdaFloodCache.lastStatus = gistdaFloodCache.data?.length ? 'cached' : 'fallback';
    return gistdaFloodCache.data ?? [];
  }
};

const predictRouteRisk = (routeId, weather, floodExposure, damLevels, traffic, rain72h = null, floodFreq = null, soilBase = null) => {
  // FloodExposure (0.45): fraction of route intersecting current GISTDA flood polygons
  const f_flood_exposure = floodExposure ?? 0.30;

  // ForecastRain (0.25): TMD NWP hourly rain intensity normalized by saturation cap
  const f_forecast_rain  = Math.min((weather?.rain ?? 0) / RAIN_SATURATION_MM, 1);

  // HistoricalIncident (0.20): GISTDA Sphere disaster-recurring API → fallback static
  const f_historical = floodFreq
    ?? (CR_HISTORICAL_INCIDENTS[ROUTE_DISTRICT[routeId]] ?? 0.60);

  // SoilRisk (0.10): LDD PiP soil base (40%) + Open-Meteo 72h rainfall saturation (60%)
  const lddBase   = soilBase ?? 0.50;
  const rainSat   = rain72h != null ? Math.min(rain72h / RAIN72H_SAT_MM, 1.0) : lddBase;
  const f_soil    = +(lddBase * 0.4 + rainSat * 0.6).toFixed(3);

  // Weighted sum per proposal formula
  const raw = 0.45 * f_flood_exposure
            + 0.25 * f_forecast_rain
            + 0.20 * f_historical
            + 0.10 * f_soil;

  // Scale [0,1] weighted output → sigmoid → [0, 99]
  const risk  = Math.min(Math.round(sigmoid(raw * 6 - 2.5) * 99), 99);
  const depth = Math.max(0.05, (risk / 65)).toFixed(2);

  // Data completeness → confidence
  const sources = [weather, floodExposure != null, damLevels, traffic].filter(Boolean).length;
  const confidence = Math.round((sources / 4) * 100);

  return {
    risk,
    depth_est: parseFloat(depth),
    confidence,
    features: {
      f_flood_exposure: +f_flood_exposure.toFixed(3),
      f_forecast_rain:  +f_forecast_rain.toFixed(3),
      f_historical:     +f_historical.toFixed(3),
      f_soil:           +f_soil.toFixed(3),
    },
  };
};

const buildContext = (weather, traffic, routeRisks) => {
  const wStr = weather ? weatherToString(weather) : 'ไม่มีข้อมูลอากาศ (TMD offline)';
  const tStr = traffic
    ? ['A', 'B', 'C'].map(id => {
        const t = traffic[id];
        return `เส้น ${id}: ${t.vehicle_count} คัน, ${t.avg_speed} กม./ชม. (${t.congestion_level})`;
      }).join(' | ')
    : 'ไม่มีข้อมูล CCTV (Supabase offline)';
  const rStr = routeRisks
    ? `A เสี่ยง ${routeRisks.A?.risk ?? '-'}%, B เสี่ยง ${routeRisks.B?.risk ?? '-'}%, C เสี่ยง ${routeRisks.C?.risk ?? '-'}%`
    : 'ไม่มีข้อมูลเส้นทาง';
  return `[อากาศ TMD]: ${wStr}\n[จราจร CCTV]: ${tStr}\n[ความเสี่ยงน้ำท่วม NetworkX A*]: ${rStr}`;
};

// ── External data metadata — Chiang Rai Province ─────────────────────────────
// API: waterlevel_load — ดึง 20 สถานีเชียงรายทั้งจังหวัดใน 1 call
// ใช้แทน waterlevel_graph ที่เรียกทีละสถานี
// situation_level: 1=ปกติ 2=เฝ้าระวัง 3=เตือนภัย
// diff_wl_bank: ระยะห่างจากตลิ่ง (บวก=ยังต่ำกว่า, ลบ=ล้นตลิ่ง)

let waterLevelCache = { data: null, ts: 0, lastStatus: 'offline' };
const WATER_LEVEL_TTL = 5 * 60_000; // refresh ทุก 5 นาที

const fetchWaterLevels = async () => {
  if (waterLevelCache.data && Date.now() - waterLevelCache.ts < WATER_LEVEL_TTL) {
    waterLevelCache.lastStatus = 'cached';
    return waterLevelCache.data;
  }
  try {
    const url = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load?province_code=57';
    const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 10000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    const rows = json?.waterlevel_data?.data ?? [];
    const stations = rows.map(row => ({
      id:              row.station?.id,
      name:            row.station?.tele_station_name?.th ?? '—',
      lat:             row.station?.tele_station_lat  ?? null,
      lon:             row.station?.tele_station_long ?? null,
      level:           row.waterlevel_msl != null ? parseFloat(row.waterlevel_msl) : null,
      warning_level:   row.station?.min_bank ?? null,
      discharge:       row.discharge != null ? parseFloat(row.discharge) : null,
      situation_level: row.situation_level ?? 1,
      diff_wl_bank:    row.diff_wl_bank  ?? null,
      datetime:        row.waterlevel_datetime ?? null,
      status:          row.waterlevel_msl != null ? 'online' : 'nodata',
    }));
    waterLevelCache = { data: stations, ts: Date.now(), lastStatus: 'live' };
    return stations;
  } catch (e) {
    console.warn('fetchWaterLevels error:', e.message);
    waterLevelCache.lastStatus = waterLevelCache.data ? 'cached' : 'offline';
    return waterLevelCache.data ?? [];
  }
};

// thaiwater.net มีเฉพาะเขื่อนใหญ่ 17 แห่ง ไม่มีเขื่อนในเชียงราย
// ใช้ แม่งัด (id=53) upstream จากเชียงราย เป็น dam pressure proxy
const DAM_META = [
  { id: 53, name: 'เขื่อนแม่งัดสมบูรณ์ชล (upstream proxy)', capacity_mcm: 265, lat: 19.163, lon: 98.934 },
];

// Shelter data cached 1 hour (Overpass rate-limited)
let shelterCache = { data: null, ts: 0 };
const SHELTER_TTL = 3_600_000;

// Safe fetch with timeout helper
const fetchWithTimeout = (url, opts = {}, ms = 8000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
};

// --- ENDPOINTS ---

app.get('/api/water-levels', async (_req, res) => {
  const stations = await fetchWaterLevels();
  res.json(stations);
});

// ── Dam levels — thaiwater.net v3 analyst/dam (numeric dam ID) ───────────────
const fetchDamLevel = async (dam) => {
  const url = `https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/dam`;
  try {
    const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 7000);
    if (!r.ok) return { ...dam, current_mcm: null, percent: null, status: 'offline' };
    const json = await r.json();
    const hourly = json?.data?.dam_hourly ?? [];
    const rec = hourly.find(h => h?.dam?.id === dam.id);
    if (!rec) return { ...dam, current_mcm: null, percent: null, status: 'nodata' };
    const current = parseFloat(rec.dam_storage) || null;
    const percent = parseFloat(rec.dam_storage_percent) || (current ? Math.min(Math.round((current / dam.capacity_mcm) * 100), 110) : null);
    const inflow  = parseFloat(rec.dam_inflow) || null;
    const outflow = parseFloat(rec.dam_released) || null;
    return { ...dam, current_mcm: current, percent, inflow, outflow, status: 'online' };
  } catch {
    return { ...dam, current_mcm: null, percent: null, status: 'error' };
  }
};

app.get('/api/dams', async (_req, res) => {
  const results = await Promise.allSettled(DAM_META.map(fetchDamLevel));
  res.json(results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { ...DAM_META[i], current_mcm: null, percent: null, status: 'error' }
  ));
});

// ── Emergency facilities — OSM Overpass (cached 1 hr) ────────────────────────
app.get('/api/shelters', async (_req, res) => {
  if (shelterCache.data && Date.now() - shelterCache.ts < SHELTER_TTL) {
    return res.json(shelterCache.data);
  }
  // bbox (19.2,99.5,20.48,100.4) = เชียงราย only, ตัด Laos/Myanmar/China border noise
  // nwr = node+way+relation ครอบคลุม polygon hospital ขนาดใหญ่
  const query = `[out:json][timeout:60];
(
  nwr["amenity"="hospital"](19.2,99.5,20.48,100.4);
  nwr["amenity"="fire_station"](19.2,99.5,20.48,100.4);
  nwr["amenity"="police"]["name"](19.2,99.5,20.48,100.4);
  node["emergency"="assembly_point"](19.2,99.5,20.48,100.4);
);
out center;`;

  try {
    const r = await fetchWithTimeout(
      'https://overpass-api.de/api/interpreter',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` },
      65000
    );
    if (!r.ok) return res.status(502).json({ error: `Overpass ${r.status}` });
    const json = await r.json();
    const THAI_LON_MAX = 100.4, THAI_LAT_MAX = 20.48;
    const shelters = (json.elements ?? [])
      .map(el => ({
        id:   el.id,
        name: el.tags?.['name:th'] ?? el.tags?.name ?? 'สถานที่ฉุกเฉิน',
        type: el.tags?.amenity ?? el.tags?.emergency ?? 'shelter',
        lat:  el.lat ?? el.center?.lat,
        lon:  el.lon ?? el.center?.lon,
      }))
      .filter(s => s.lat && s.lon && s.lon <= THAI_LON_MAX && s.lat <= THAI_LAT_MAX);
    shelterCache = { data: shelters, ts: Date.now() };
    res.json(shelters);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// ── TMD official weather warnings ─────────────────────────────────────────────
app.get('/api/warnings', async (_req, res) => {
  try {
    const r = await fetchWithTimeout(
      `https://data.tmd.go.th/api/v1/warnings?province=เชียงราย&type=json`,
      { headers: { Authorization: `Bearer ${TMD_TOKEN}`, Accept: 'application/json' } },
      8000
    );
    if (!r.ok) return res.status(502).json({ error: `TMD warnings: ${r.status}` });
    res.json(await r.json());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    services: {
      supabase: supabase ? 'connected' : 'offline',
      typhoon: typhoon ? 'connected' : 'offline',
    },
  });
});

// TMD weather proxy (frontend เรียกผ่านนี้เพื่อหลีกเลี่ยง CORS)
app.get('/api/tmd/forecast', async (req, res) => {
  try {
    const { lat, lon, duration } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });

    // คำนวณวันที่/ชั่วโมงกรุงเทพเสมอ (client อาจส่ง UTC date มาซึ่งผิด)
    const bangkokNow = new Date(Date.now() + 7 * 3_600_000);
    const reqDate = bangkokNow.toISOString().slice(0, 10);
    const headers = { Authorization: `Bearer ${TMD_TOKEN}`, Accept: 'application/json' };

    // ลอง hour ปัจจุบัน (Bangkok) ก่อน → fallback hour=0 ถ้า API ไม่มีข้อมูล
    let tmdData = null;
    for (const h of [bangkokNow.getUTCHours(), 0]) {
      try {
        const url = `https://data.tmd.go.th/nwpapi/v1/forecast/location/hourly/at` +
          `?lat=${lat}&lon=${lon}&fields=tc,rh,rain,ws10m,wd10m,cond` +
          `&date=${reqDate}&hour=${h}&duration=${duration || 6}`;
        const resp = await fetch(url, { headers });
        if (!resp.ok) continue;
        const j = await resp.json().catch(() => null);
        if ((j?.WeatherForecasts?.[0]?.forecasts ?? []).length > 0) { tmdData = j; break; }
      } catch { continue; }
    }

    if (tmdData) return res.json(tmdData);

    console.warn(`TMD no data for (${lat},${lon})`);
    return res.status(503).json({ error: 'TMD no forecast data available' });
  } catch (error) {
    console.error('TMD proxy error:', error.message);
    res.status(503).json({ error: `TMD proxy unavailable: ${error.message}` });
  }
});

// CCTV route summary — returns zeros when Supabase offline (frontend handles gracefully)
app.get('/api/vehicles/route-summary', async (_req, res) => {
  const live = await fetchLiveTraffic();
  if (live) return res.json(live);
  const empty = { vehicle_count: 0, avg_speed: 0, congestion_level: 'unknown', stopped_ratio: 0 };
  res.json({ A: empty, B: empty, C: empty });
});

// AI Chat (Typhoon)
app.post('/api/ai/chat', async (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Invalid request body' });
  const { message, history, routeRisks } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing message' });
  }
  if (!typhoon) return res.status(503).json({ error: 'Typhoon AI not configured — set TYPHOON_API_KEY' });

  try {
    const [weather, traffic] = await Promise.all([fetchLiveWeather(), fetchLiveTraffic()]);
    const context = buildContext(weather, traffic, routeRisks ?? null);

    const systemPrompt = `คุณคือ FloodNav AI ผู้ช่วยนำทางเลี่ยงน้ำท่วมสำหรับจังหวัดเชียงราย (4 อำเภอ: เมือง, แม่สาย, เทิง, เวียงป่าเป้า)
ตอบภาษาไทย กระชับ ไม่เกิน 5 ประโยค อิงข้อมูลใน CONTEXT เท่านั้น ห้ามแต่งข้อมูลนอก CONTEXT
หากพบการรายงานภัย (น้ำท่วม/ดินถล่ม/สิ่งกีดขวาง) ให้ตอบรับและระบุว่ากำลังรัน addIncident()

[CONTEXT]
${context}`;

    // Keyword → tool call detection (Chiang Rai locations)
    const KNOWN_LOCATIONS = [
      { keyword: 'แม่สาย',       name: 'อ.แม่สาย',       lat: 20.434, lon: 99.882, severity: 0.92 },
      { keyword: 'เวียงป่าเป้า', name: 'อ.เวียงป่าเป้า', lat: 19.375, lon: 99.858, severity: 0.95 },
      { keyword: 'เทิง',         name: 'อ.เทิง',          lat: 19.977, lon: 100.074, severity: 0.80 },
      { keyword: 'ห้วยสัก',      name: 'บ.ห้วยสัก',       lat: 19.870, lon: 99.850 },
      { keyword: 'แม่น้ำกก',     name: 'แม่น้ำกก เมือง', lat: 19.908, lon: 99.832 },
      { keyword: 'สนามบิน',      name: 'สนามบินเชียงราย', lat: 19.952, lon: 99.883 },
    ];

    let toolCall = null;
    const lower = message.toLowerCase();
    if (/ท่วม|หลาก|ถล่ม|ดินสไลด์|ขวาง|blocked|flood|landslide/i.test(message)) {
      const loc = KNOWN_LOCATIONS.find(l => lower.includes(l.keyword))
        ?? { name: 'จุดเสี่ยงภัยฉุกเฉิน', lat: 18.79, lon: 98.99 };
      const depthMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:เมตร|ม\.|m)/);
      const depth    = depthMatch ? parseFloat(depthMatch[1]) : 1.2;
      const severity = loc.severity ?? 0.8;
      toolCall = { name: 'addIncident', arguments: { name: `${loc.name} (แจ้งเตือนใหม่)`, lat: loc.lat, lon: loc.lon, depth, severity } };
    } else if (/อธิบาย|explain|เหตุผล|ทำไม|คะแนนความเสี่ยง/i.test(message)) {
      toolCall = { name: 'explainRoute', arguments: {} };
    } else if (/จัดสรร|แบ่งเรือ|optimizer/i.test(message)) {
      toolCall = { name: 'optimizeAllocation', arguments: {} };
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...((Array.isArray(history) ? history : []).slice(-10)),
      { role: 'user', content: message },
    ];

    const completion = await typhoon.chat.completions.create({
      model: 'typhoon-v2.5-30b-a3b-instruct',
      messages,
      max_tokens: 512,
      temperature: 0.7,
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply, toolCall });
  } catch (error) {
    console.error('Typhoon chat error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// AI Situation Briefing (Typhoon)
app.get('/api/ai/briefing', async (_req, res) => {
  if (!typhoon) return res.status(503).json({ error: 'Typhoon AI not configured — set TYPHOON_API_KEY' });

  try {
    const [weather, traffic] = await Promise.all([fetchLiveWeather(), fetchLiveTraffic()]);
    const context = buildContext(weather, traffic, null);

    // คำนวณ alert_level จากข้อมูลจริง
    let alert_level = 1;
    if (traffic) {
      if (traffic.C?.congestion_level === 'blocked' || traffic.B?.congestion_level === 'blocked') alert_level = 3;
      else if (traffic.B?.congestion_level === 'warning') alert_level = 2;
    }
    if (weather?.rain != null && weather.rain > 15) alert_level = Math.max(alert_level, 2);

    const completion = await typhoon.chat.completions.create({
      model: 'typhoon-v2.5-30b-a3b-instruct',
      messages: [
        {
          role: 'system',
          content: 'คุณคือระบบสรุปสถานการณ์ภัยพิบัติเชียงราย (4 อำเภอ: เมือง แม่สาย เทิง เวียงป่าเป้า) สรุป 3-4 ประโยคภาษาไทย ระบุเวลา สภาพอากาศ จราจร และแนะนำเส้นทาง อิง CONTEXT เท่านั้น',
        },
        { role: 'user', content: `[CONTEXT]\n${context}\n\nสรุปสถานการณ์:` },
      ],
      max_tokens: 300,
      temperature: 0.6,
    });

    const briefing = completion.choices[0].message.content.trim();
    res.json({ briefing, generated_at: new Date().toISOString(), alert_level });
  } catch (error) {
    console.error('Typhoon briefing error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GISTDA Open Data Flood proxy — api-gateway.gistda.or.th (real endpoint, confirmed from JS bundle)
// pv_idn=57 = เชียงราย, auth via API-Key header
// Returns GeoJSON FeatureCollection; features[] is empty when no active flooding (not an error)
app.get('/api/gistda/flood', async (req, res) => {
  try {
    const dataKey = process.env.VITE_GISTDA_DATA_KEY;
    const VALID_RANGES = ['1day', '3days', '7days', '30days'];
    const range = VALID_RANGES.includes(req.query.range) ? req.query.range : '7days';
    const url = `https://api-gateway.gistda.or.th/api/2.0/resources/features/flood/${range}?pv_idn=57&limit=1000`;
    const response = await fetch(url, { headers: { 'API-Key': dataKey } });
    if (!response.ok) throw new Error(`GISTDA API returned HTTP ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('GISTDA Flood proxy error:', error.message);
    res.status(502).json({ error: 'Failed to fetch GISTDA flood data from remote source.' });
  }
});


// ── XAI route explanation — Typhoon explains risk factors in Thai ──────────────
app.post('/api/explain', async (req, res) => {
  if (!typhoon) return res.status(503).json({ error: 'Typhoon AI not configured' });
  const { routes } = req.body ?? {};
  if (!Array.isArray(routes) || routes.length === 0) {
    return res.status(400).json({ error: 'Missing routes array' });
  }

  const routeSummary = routes.map(r => {
    const f = r.features ?? {};
    return `เส้นทาง ${r.id}: ความเสี่ยง ${r.risk}% | FloodExposure ${((f.f_flood_exposure ?? 0) * 100).toFixed(0)}% | ForecastRain ${((f.f_forecast_rain ?? 0) * 100).toFixed(0)}% | HistoricalIncident ${((f.f_historical ?? 0) * 100).toFixed(0)}% | SoilRisk ${((f.f_soil ?? 0) * 100).toFixed(0)}%`;
  }).join('\n');

  try {
    const completion = await typhoon.chat.completions.create({
      model: 'typhoon-v2.5-30b-a3b-instruct',
      messages: [
        {
          role: 'system',
          content: 'คุณคือระบบอธิบายการตัดสินใจ AI (Explainable AI) สำหรับระบบนำทางเลี่ยงน้ำท่วมเชียงราย อธิบายเหตุผลคะแนนความเสี่ยงแต่ละเส้นทาง 3-5 ประโยคภาษาไทย ระบุปัจจัยหลักที่มีผล',
        },
        {
          role: 'user',
          content: `อธิบายความเสี่ยงและแนะนำเส้นทางที่เหมาะสมที่สุดจากข้อมูลต่อไปนี้:\n${routeSummary}`,
        },
      ],
      max_tokens: 400,
      temperature: 0.5,
    });
    res.json({ explanation: completion.choices[0].message.content.trim(), generated_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Human Override — persisted to Supabase decision_logs + in-memory fallback ──
// Run once in Supabase dashboard to create the table:
//   create table decision_logs (
//     id text primary key,
//     route_id text not null,
//     reason text not null,
//     officer text not null,
//     created_at timestamptz default now()
//   );
//   create index on decision_logs (created_at desc);
const overrideLog = [];

app.post('/api/override', async (req, res) => {
  const { routeId, reason, officer } = req.body ?? {};
  if (!routeId || !reason || !officer) {
    return res.status(400).json({ error: 'Missing routeId, reason, or officer' });
  }
  const record = {
    id:        `OVR-${Date.now()}`,
    routeId,
    reason,
    officer,
    timestamp: new Date().toISOString(),
  };
  overrideLog.unshift(record);
  if (overrideLog.length > 100) overrideLog.pop();
  console.log(`[OVERRIDE] ${record.id} — ${officer} selected route ${routeId}: ${reason}`);

  if (supabase) {
    supabase.from('decision_logs')
      .insert({ id: record.id, route_id: routeId, reason, officer, created_at: record.timestamp })
      .then(({ error }) => { if (error) console.warn('[OVERRIDE] Supabase insert failed:', error.message); });
  }

  res.json({ success: true, record });
});

app.get('/api/override/log', async (_req, res) => {
  if (supabase) {
    const { data, error } = await supabase
      .from('decision_logs')
      .select('id, route_id, reason, officer, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && data?.length) {
      return res.json(data.map(r => ({
        id:        r.id,
        routeId:   r.route_id,
        reason:    r.reason,
        officer:   r.officer,
        timestamp: r.created_at,
      })));
    }
  }
  res.json(overrideLog);
});

// ── A* Flood-Aware Routes — pre-computed NetworkX geometry + live ML risk ─────
// Geometry traced from OSMnx/Thai highway network for CR province (flood_routing.ipynb)
const FLOOD_ROUTE_GEOMETRY = {
  A: {
    name: 'ทล.1 เมือง→แม่สาย', distance_km: 61.2,
    coords: [[99.832,19.908],[99.838,19.942],[99.843,19.980],[99.850,20.025],[99.856,20.075],
              [99.861,20.120],[99.866,20.175],[99.869,20.235],[99.873,20.300],[99.877,20.365],[99.882,20.434]],
  },
  B: {
    name: 'ทล.1020 เมือง→เทิง', distance_km: 44.8,
    coords: [[99.832,19.908],[99.865,19.915],[99.900,19.924],[99.942,19.938],[99.983,19.952],[100.028,19.963],[100.074,19.977]],
  },
  C: {
    name: 'ทล.118 เมือง→เวียงป่าเป้า', distance_km: 77.5,
    coords: [[99.832,19.908],[99.836,19.862],[99.840,19.808],[99.843,19.745],[99.847,19.675],
              [99.851,19.600],[99.854,19.525],[99.857,19.455],[99.858,19.410],[99.858,19.375]],
  },
};

// Load pre-computed A* GeoJSON from flood_routing.ipynb output (run_flood_routing.py)
let floodRoutesGeoJSON = null;
const FLOOD_ROUTES_FILE = path.resolve('data/flood_routes.geojson');
try {
  floodRoutesGeoJSON = JSON.parse(fs.readFileSync(FLOOD_ROUTES_FILE, 'utf8'));
  console.log(`✓ flood_routes.geojson loaded (${floodRoutesGeoJSON.features.length} routes)`);
} catch {
  console.warn('⚠ flood_routes.geojson not found — will use static geometry fallback');
}

app.get('/api/flood-routes', async (_req, res) => {
  try {
    // Fetch all live sensor data in parallel
    const [weather, traffic, rain72hMap, gistdaFeatures, damResults,
           freqFeatA, freqFeatB, freqFeatC] = await Promise.all([
      fetchLiveWeather(), fetchLiveTraffic(), fetchRain72h(),
      fetchGistdaCurrentFlood(),
      Promise.allSettled(DAM_META.map(fetchDamLevel)),
      fetchFloodFreqFeatures('A'), fetchFloodFreqFeatures('B'), fetchFloodFreqFeatures('C'),
    ]);
    const freqFeatMap = { A: freqFeatA, B: freqFeatB, C: freqFeatC };
    const damLevels = damResults
      .map(r => r.status === 'fulfilled' && r.value?.percent != null ? r.value : null)
      .filter(Boolean);

    const result = {};

    if (floodRoutesGeoJSON) {
      // Use real A* geometry from flood_routes.geojson
      for (const feat of floodRoutesGeoJSON.features) {
        const id     = feat.properties.route_id;
        const coords = feat.geometry.coordinates; // [[lon, lat], ...]
        const points = coords.map(([lon, lat]) => ({ lat, lon }));
        const exposure   = routeFloodExposure(points, gistdaFeatures);
        const historical = computeHistoricalRisk(points, freqFeatMap[id]);
        const soilBase   = computeRouteSoilRisk(points);
        const ml = predictRouteRisk(id, weather, exposure,
          damLevels.length ? damLevels : null,
          traffic, rain72hMap[id] ?? null, historical, soilBase);
        result[id] = {
          name:         feat.properties.name,
          distance_km:  feat.properties.distance_km,
          duration_min: Math.round(feat.properties.distance_km / 45 * 60),
          points:       points,
          risk:         ml.risk,
          depth:        ml.depth_est,
          algorithm:    'NetworkX A* (OSM PBF — flood-weighted)',
          features:     ml.features,
          graph_risk:   feat.properties.risk_pct,
        };
      }
    } else {
      // Fallback to static geometry when geojson not available
      for (const [id, geo] of Object.entries(FLOOD_ROUTE_GEOMETRY)) {
        const points     = geo.coords.map(([lon, lat]) => ({ lat, lon }));
        const exposure   = routeFloodExposure(points, gistdaFeatures);
        const historical = computeHistoricalRisk(points, freqFeatMap[id]);
        const soilBase   = computeRouteSoilRisk(points);
        const ml = predictRouteRisk(id, weather, exposure,
          damLevels.length ? damLevels : null,
          traffic, rain72hMap[id] ?? null, historical, soilBase);
        result[id] = {
          name:         geo.name,
          distance_km:  geo.distance_km,
          duration_min: Math.round(geo.distance_km / 45 * 60),
          points:       points,
          risk:         ml.risk,
          depth:        ml.depth_est,
          algorithm:    'static geometry (fallback)',
          features:     ml.features,
        };
      }
    }

    // Build per-request data source status flags
    const anyDamOnline = damResults.some(r => r.status === 'fulfilled' && r.value?.status === 'online');
    const dataStatus = {
      gistdaFlood: gistdaFloodCache.lastStatus,
      tmdForecast: weather         ? 'live'    : 'offline',
      floodFreq:   floodFreqFeatCache.lastStatus,
      lddSoil:     SOIL_POLYGONS.length > 0 ? 'local' : 'fallback',
      rain72h:     rain72hCache.lastStatus,
      thaiWater:   anyDamOnline    ? 'live'    : waterLevelCache.lastStatus,
      traffic:     traffic         ? 'live'    : 'offline',
    };

    res.json({ ...result, _meta: { dataStatus, timestamp: new Date().toISOString() } });
  } catch (err) {
    console.error('flood-routes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Dynamic routes ────────────────────────────────────────────────────────────

const haversineM = (lat1, lon1, lat2, lon2) => {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const dynFreqCache = new Map();
const DYN_FREQ_TTL = 60 * 60_000;

const fetchFloodFreqForBbox = async (bbox) => {
  const key = bbox.map(v => v.toFixed(4)).join(',');
  const cached = dynFreqCache.get(key);
  if (cached && Date.now() - cached.ts < DYN_FREQ_TTL) return cached.data;
  try {
    const dataKey = process.env.VITE_GISTDA_DATA_KEY;
    const url = `https://api-gateway.gistda.or.th/api/2.0/resources/features/flood-freq` +
      `?bbox=${bbox.join(',')}&pv_idn=57&limit=1000`;
    const r = await fetchWithTimeout(url, { headers: { 'API-Key': dataKey } }, 12000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const data = j.features ?? [];
    dynFreqCache.set(key, { data, ts: Date.now() });
    return data;
  } catch (e) {
    console.warn('fetchFloodFreqForBbox:', e.message);
    return [];
  }
};

// Compute blocked-point detail fields for one route
function blockedDetails(points, blockedPoints) {
  if (!blockedPoints?.length || !points?.length) {
    return { blocked: false, closureStatus: 'clear', blockedExposure: 0, blockedPenalty: 0, blockedDistanceM: null, nearestBlockedPoint: null };
  }
  let minDist = Infinity;
  let minBp   = null;
  let hitCount = 0;
  for (const pt of points) {
    for (const bp of blockedPoints) {
      const d = haversineM(pt.lat, pt.lon, bp.lat, bp.lon);
      if (d < minDist) { minDist = d; minBp = bp; }
      if (d <= (bp.radiusM ?? 500)) hitCount++;
    }
  }
  const blocked = hitCount > 0;
  return {
    blocked,
    closureStatus:       blocked ? 'penalized' : 'clear',
    blockedExposure:     +(hitCount / points.length).toFixed(3),
    blockedPenalty:      blocked ? 25 : 0,
    blockedDistanceM:    minDist !== Infinity ? Math.round(minDist) : null,
    nearestBlockedPoint: minBp ? { lat: minBp.lat, lon: minBp.lon, radiusM: minBp.radiusM ?? 500 } : null,
  };
}

// Score precomputed A/B/C routes and return as dynamic-route shape (OSRM failure fallback)
async function buildFixedFallbackRoutes(weather, gistdaFeatures, rain72hMap, damLevels, rain72hAvg) {
  const [freqFeatA, freqFeatB, freqFeatC] = await Promise.all(
    ['A', 'B', 'C'].map(fetchFloodFreqFeatures)
  );
  const freqFeatMap = { A: freqFeatA, B: freqFeatB, C: freqFeatC };
  const routes = [];
  for (const id of ['A', 'B', 'C']) {
    let points, name, distanceKm;
    if (floodRoutesGeoJSON) {
      const feat = floodRoutesGeoJSON.features.find(f => f.properties.route_id === id);
      if (!feat) continue;
      points = feat.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
      name = feat.properties.name;
      distanceKm = feat.properties.distance_km;
    } else {
      const geo = FLOOD_ROUTE_GEOMETRY[id];
      points = geo.coords.map(([lon, lat]) => ({ lat, lon }));
      name = geo.name;
      distanceKm = geo.distance_km;
    }
    const exposure   = routeFloodExposure(points, gistdaFeatures);
    const historical = computeHistoricalRisk(points, freqFeatMap[id]);
    const soilBase   = computeRouteSoilRisk(points);
    const ml = predictRouteRisk(id, weather, exposure, damLevels.length ? damLevels : null, null,
      rain72hMap[id] ?? rain72hAvg, historical, soilBase);
    routes.push({
      id, name,
      distanceKm,
      durationMin: Math.round(distanceKm / 45 * 60),
      risk:    ml.risk,
      safety:  100 - ml.risk,
      blocked: false, closureStatus: 'clear', blockedExposure: 0, blockedPenalty: 0, blockedDistanceM: null, nearestBlockedPoint: null,
      features: ml.features,
      geometry: { type: 'LineString', coordinates: points.map(p => [p.lon, p.lat]) },
      points,
    });
  }
  return routes.sort((a, b) => a.risk - b.risk);
}

app.post('/api/dynamic-routes', async (req, res) => {
  try {
    const { start, end, blockedPoints = [], routeCount = 3 } = req.body ?? {};
    if (!start?.lat || !start?.lon || !end?.lat || !end?.lon) {
      return res.status(400).json({ error: 'start and end coordinates are required' });
    }

    const ROUTING_ENGINE = 'OSRM public API (router.project-osrm.org)';
    const LIMITATIONS    = 'Blocked points are applied as post-route risk penalties, not graph-level edge removals. Route geometry may still pass through blocked zones.';

    // Fetch OSRM and all live data in parallel to minimise latency
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?alternatives=true&geometries=geojson&overview=full&steps=false`;
    const [osrmResult, weather, gistdaFeatures, rain72hMap, damResults] = await Promise.all([
      fetchWithTimeout(osrmUrl, {}, 15000).then(r => r.json()).catch(() => null),
      fetchLiveWeather(),
      fetchGistdaCurrentFlood(),
      fetchRain72h(),
      Promise.allSettled(DAM_META.map(fetchDamLevel)),
    ]);

    const damLevels = damResults
      .filter(r => r.status === 'fulfilled' && r.value?.percent != null)
      .map(r => r.value);
    const rain72hValues = Object.values(rain72hMap ?? {}).filter(v => typeof v === 'number');
    const rain72hAvg = rain72hValues.length ? rain72hValues.reduce((a, b) => a + b, 0) / rain72hValues.length : null;

    const buildDataStatus = (roadGraph) => ({
      roadGraph,
      gistdaFlood: gistdaFloodCache.lastStatus,
      tmdForecast: weather ? 'live' : 'offline',
      floodFreq:   floodFreqFeatCache.lastStatus,
      lddSoil:     SOIL_POLYGONS.length > 0 ? 'local' : 'fallback',
      rain72h:     rain72hCache.lastStatus,
    });

    // OSRM failed → serve pre-scored fixed routes as transparent fallback
    if (!osrmResult || osrmResult.code !== 'Ok') {
      const reason = osrmResult ? (osrmResult.message ?? 'OSRM routing failed') : 'OSRM request timed out';
      console.warn('[dynamic-routes] OSRM unavailable:', reason, '— serving fixed-route fallback');
      const fixedRoutes = await buildFixedFallbackRoutes(weather, gistdaFeatures, rain72hMap, damLevels, rain72hAvg);
      return res.json({
        routes: fixedRoutes,
        _meta: {
          mode: 'fixed-fallback',
          fallback: true,
          fallbackReason: reason,
          routingEngine: 'Precomputed routes (OSRM unavailable)',
          limitations:   LIMITATIONS,
          requestedCount: routeCount,
          returnedCount:  fixedRoutes.length,
          dataStatus: buildDataStatus('offline'),
        },
      });
    }

    // Filter routes missing geometry before scoring (guards against malformed OSRM response)
    const osrmRoutes = osrmResult.routes
      .filter(r => r.geometry?.coordinates?.length >= 2)
      .slice(0, Math.max(routeCount, 3));
    const scored = await Promise.all(osrmRoutes.map(async (r, i) => {
      const coords = r.geometry.coordinates;
      const points = coords.map(([lon, lat]) => ({ lat, lon }));
      const bbox   = [
        Math.min(...coords.map(c => c[0])), Math.min(...coords.map(c => c[1])),
        Math.max(...coords.map(c => c[0])), Math.max(...coords.map(c => c[1])),
      ];
      const [freqFeats] = await Promise.all([fetchFloodFreqForBbox(bbox)]);
      const exposure   = routeFloodExposure(points, gistdaFeatures);
      const historical = computeHistoricalRisk(points, freqFeats);
      const soilBase   = computeRouteSoilRisk(points);
      const ml = predictRouteRisk('DYN' + i, weather, exposure, damLevels.length ? damLevels : null, null, rain72hAvg, historical, soilBase);
      const closure = blockedDetails(points, blockedPoints);
      return {
        id: 'DYN' + i, name: 'Route ' + (i + 1),
        distanceKm:  +(r.distance / 1000).toFixed(2),
        durationMin: +(r.duration / 60).toFixed(1),
        risk:   Math.min(ml.risk + closure.blockedPenalty, 99),
        safety: Math.max(100 - ml.risk - closure.blockedPenalty, 1),
        features: ml.features,
        geometry: r.geometry,
        points,
        ...closure,
      };
    }));

    const scoredRoutes = scored
      .sort((a, b) => a.risk - b.risk)
      .map((route, idx) => ({ ...route, id: 'R' + (idx + 1), name: 'Route ' + (idx + 1) }))
      .slice(0, routeCount);

    const allRoutesAffected = scoredRoutes.length > 0 && scoredRoutes.every(r => r.blocked);

    res.json({
      routes: scoredRoutes,
      _meta: {
        mode:             'dynamic',
        routingEngine:    ROUTING_ENGINE,
        limitations:      LIMITATIONS,
        requestedCount:   routeCount,
        returnedCount:    scoredRoutes.length,
        allRoutesAffected: allRoutesAffected || undefined,
        dataStatus: buildDataStatus('live'),
      },
    });
  } catch (err) {
    console.error('dynamic-routes error:', err.message);
    res.status(500).json({ error: err.message, fallback: true });
  }
});

// ── GISTDA flood-freq values (per route, from /features/flood-freq bbox PiP) ────
app.get('/api/gistda/flood-freq-values', async (_req, res) => {
  const [fA, fB, fC] = await Promise.all(['A','B','C'].map(fetchFloodFreqFeatures));
  const DUMMY_POINTS = { A: FLOOD_ROUTE_GEOMETRY.A.coords, B: FLOOD_ROUTE_GEOMETRY.B.coords, C: FLOOD_ROUTE_GEOMETRY.C.coords };
  const routes = {};
  for (const id of ['A','B','C']) {
    const pts = DUMMY_POINTS[id].map(([lon,lat]) => ({lat,lon}));
    const feat = id === 'A' ? fA : id === 'B' ? fB : fC;
    routes[id] = computeHistoricalRisk(pts, feat);
  }
  res.json({ routes, source: 'GISTDA /features/flood-freq bbox PiP (2011-2024)', years: FLOOD_FREQ_YEARS });
});

// System status logs — real connection state, no hardcoded data
app.get('/api/vehicles/logs', (_req, res) => {
  const t = new Date().toLocaleTimeString('en-GB');
  const logs = [
    { time: t, type: 'system', text: `FloodNav server online — port ${PORT}` },
    { time: t, type: supabase  ? 'info'  : 'warn', text: supabase  ? 'Supabase CCTV: connected'              : 'Supabase CCTV: offline (ไม่มี SUPABASE_URL/KEY)' },
    { time: t, type: typhoon   ? 'info'  : 'warn', text: typhoon   ? 'Typhoon AI: connected'                 : 'Typhoon AI: offline (ไม่มี TYPHOON_API_KEY)'     },
    { time: t, type: TMD_TOKEN ? 'info'  : 'warn', text: TMD_TOKEN ? 'TMD Weather API: token configured'     : 'TMD Weather API: ไม่มี TMD_TOKEN'               },
  ];
  res.json(logs);
});

app.listen(PORT, () => {
  console.log(`\n🚀 FloodNav server on http://localhost:${PORT} — จังหวัดเชียงราย`);
  console.log(`📡 TMD proxy:    /api/tmd/forecast`);
  console.log(`📡 CCTV traffic: /api/vehicles/route-summary`);
  console.log(`🗺️  A* routes:    /api/flood-routes`);
  console.log(`📊 Flood freq:   /api/gistda/flood-freq-values`);
  console.log(`🌀 AI chat:      /api/ai/chat`);
  console.log(`🌀 AI briefing:  /api/ai/briefing`);
  console.log(`🔍 XAI explain:  POST /api/explain`);
  console.log(`✋ Override:     POST /api/override\n`);

  // Pre-warm flood-freq polygon cache for all routes (non-blocking, cached 24h)
  Promise.all(['A','B','C'].map(id => fetchFloodFreqFeatures(id))).catch(() => {});
});

export default app;
