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

const TMD_TOKEN = process.env.TMD_TOKEN || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6ImI5YzJkODUwZTA1OWJiYTE5NDliYzhjZTEyODllZWIyMjFlYjA4MTE5NGY4MTBhYWRhMjNiNTExMzdmZWQzZWFjMWY1YWI4NzNmMGNhZTFjIn0.eyJhdWQiOiIyIiwianRpIjoiYjljMmQ4NTBlMTU5YmJhMTk0OWJjOGNlMTI4OWVlYjIyMWViMDgxMTk0ZjgxMGFhZGEyM2I1MTEzN2ZlZDNlYWMxZjVhYjg3M2YwY2FlMWMiLCJpYXQiOjE3NzcyMTU1NzAsIm5iZiI6MTc3NzIxNTU3MCwiZXhwIjoxODA4NzUxNTcwLCJzdWIiOiI1MjMzIiwic2NvcGVzIjpbXX0.tHJVqVgv4YmwrUr5HeLTlJ1qfXPpXmVGOonCIZMIXj00FDTHGQ6u8SjCKm30kBy3F6NfQjldOVh8Y2LcP8UhHqYM-jxwm35qctp_S7hiSLr9bnLJND-Fl2Q3brqGRgGsfLVRBTDYlG3i4KoGxXjnswik1j_HIS9J_efkqeBbRhbs9DLWMEEw29DA5EUJmuBYR8M1Cl9T7XMeOkBt_ZIpYHEc9sIMSZwB8MV0yf6eSeQRZv2une9oZ4Nf0yccjZdMYapLrN0Jy-54HFgF3HL24aWPddQQP4I8JX_Y8fB-adThH8PGov78dNPCHC3hPf7R0AAsVxUmqeDS3zCHdFXd4BywD0D6KgDyLyq0scB3YyZP1sGhINCU3tFvIeNmP42kkwT1R221h7y0nEaoSiBTMNqTeZHNw4Ty7GNzVrAyV68nyZ4nnnvkqhAqOhcDiyh42a2ro7-xqOZcIREPuaxtVL6Jfp3Kha8gsA7QWncp9ooBVamjc-0QEvw-CP0h4_8mm6wzg6NRgWjouWBwcNsw93Wf3eOJhynjuOLMttGvQbiH2WWDq9e5CLQuVb8qqLVcfN7R06UQh9Ynw9JdOVY4CjXFMXeRyqkLO99ThuyxBW5-eSYTkrmCnnw8tadJ9uiIvzcTZUwFlCocss7biergwjcPbRYBn7SMglcDZUVjAq8';

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
    const lat = 19.908, lon = 99.832;   // เมืองเชียงราย
    const date = new Date().toISOString().slice(0, 10);
    const hour = new Date().getHours();
    const url = `https://data.tmd.go.th/nwpapi/v1/forecast/hourly/at?lat=${lat}&lon=${lon}&fields=tc,rh,rr,ws,wd,cond&date=${date}&hour=${hour}&duration=${FORECAST_DURATION}`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${TMD_TOKEN}`, 'Accept': 'application/json' },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json?.WeatherForecasts?.[0]?.forecasts?.[0]?.data ?? null;
  } catch {
    return null;
  }
};

const weatherToString = (w) => {
  if (!w) return null;
  const dirs = ['เหนือ','ตะวันออกเฉียงเหนือ','ตะวันออก','ตะวันออกเฉียงใต้','ใต้','ตะวันตกเฉียงใต้','ตะวันตก','ตะวันตกเฉียงเหนือ'];
  const dirName = dirs[Math.round((w.wd ?? 0) / 45) % 8] ?? 'ไม่ระบุ';
  return `อุณหภูมิ: ${w.tc ?? '-'}°C, ฝนสะสม: ${w.rr ?? 0} mm/hr, ความชื้น: ${w.rh ?? '-'}%, ลม: ${w.ws ?? 0} m/s ทิศ${dirName}`;
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
//   RiskScore = (0.45 × FloodDepth) + (0.25 × DepthTrend) + (0.20 × HistoricalIncident) + (0.10 × SoilRisk)
//
// Feature sources:
//   FloodDepth        — river level ratio vs. warning level (water sensor / SAR proxy)
//   DepthTrend        — rainfall accumulation intensity as flood-rise trend proxy
//   HistoricalIncident— static district-level flood incident frequency (disaster.go.th)
//   SoilRisk          — static LDD soil permeability/saturation risk per route

// Historical flood incident frequencies for 4 Chiang Rai districts (disaster.go.th static data)
const CR_HISTORICAL_INCIDENTS = {
  'เวียงป่าเป้า': 0.88,  // highest — mountain watershed, flash floods
  'แม่สาย':      0.78,  // border area, Sai/Kok River confluence risk
  'เทิง':        0.62,  // Mekong tributary area
  'เมือง':       0.52,  // Chiang Rai city — moderate, better drainage
};

// LDD soil risk per route (static — higher = clay/saturation risk)
const CR_SOIL_RISK = {
  A: 0.30,  // Route A: ทล.1 เมือง→แม่สาย — paved trunk road, lower soil exposure
  B: 0.55,  // Route B: ทล.118 เมือง→เทิง — agricultural fringe areas
  C: 0.85,  // Route C: ทางลัดเวียงป่าเป้า — mountain watershed, high clay/slope risk
};

// Route → primary district mapping for HistoricalIncident lookup
const ROUTE_DISTRICT = { A: 'แม่สาย', B: 'เทิง', C: 'เวียงป่าเป้า' };

const sigmoid = x => 1 / (1 + Math.exp(-x));

/**
 * Compute flood risk score [0–99] for a single route.
 * Returns { risk, depth_est, confidence, features }
 */
const predictRouteRisk = (routeId, weather, waterLevels, damLevels, traffic) => {
  // FloodDepth (0.45): river level ratio vs. warning threshold
  const f_flood_depth = waterLevels?.length
    ? waterLevels.reduce((s, st) => {
        const ratio = (st.level != null && st.warning_level)
          ? st.level / st.warning_level : 0.30;
        return s + Math.min(ratio, 1.5);
      }, 0) / waterLevels.length
    : 0.30;

  // DepthTrend (0.25): rainfall intensity as real-time flood-rise trend proxy
  const f_depth_trend = Math.min((weather?.rr ?? 0) / RAIN_SATURATION_MM, 1);

  // HistoricalIncident (0.20): static district flood-frequency
  const f_historical = CR_HISTORICAL_INCIDENTS[ROUTE_DISTRICT[routeId]] ?? 0.60;

  // SoilRisk (0.10): static LDD soil saturation risk per route
  const f_soil = CR_SOIL_RISK[routeId] ?? 0.50;

  // Weighted sum per proposal formula
  const raw = 0.45 * f_flood_depth
            + 0.25 * f_depth_trend
            + 0.20 * f_historical
            + 0.10 * f_soil;

  // Scale [0,1] weighted output → sigmoid → [0, 99]
  const risk  = Math.min(Math.round(sigmoid(raw * 6 - 2.5) * 99), 99);
  const depth = Math.max(0.05, (risk / 65)).toFixed(2);

  // Data completeness → confidence
  const sources = [weather, waterLevels, damLevels, traffic].filter(Boolean).length;
  const confidence = Math.round((sources / 4) * 100);

  return {
    risk,
    depth_est: parseFloat(depth),
    confidence,
    features: {
      f_flood_depth:  +f_flood_depth.toFixed(3),
      f_depth_trend:  +f_depth_trend.toFixed(3),
      f_historical:   +f_historical.toFixed(3),
      f_soil:         +f_soil.toFixed(3),
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
    : 'ไม่มีข้อมูล OSRM';
  return `[อากาศ TMD]: ${wStr}\n[จราจร CCTV]: ${tStr}\n[ความเสี่ยงน้ำท่วม OSRM]: ${rStr}`;
};

// ── External data metadata — Chiang Rai Province ─────────────────────────────

const RIVER_STATIONS = [
  { id: 'K.1',  name: 'แม่น้ำกก เมืองเชียงราย',  lat: 19.908, lon: 99.832 },
  { id: 'K.2A', name: 'แม่น้ำกก บ้านสบกก',       lat: 20.218, lon: 99.882 },
  { id: 'W.1A', name: 'แม่น้ำวัง เทิง',           lat: 19.977, lon: 100.074 },
  { id: 'L.1',  name: 'แม่น้ำลาว เวียงป่าเป้า',   lat: 19.375, lon: 99.858 },
];

const DAM_META = [
  { code: 'huai_sak',  name: 'อ่างเก็บน้ำห้วยสัก', capacity_mcm: 117 },
  { code: 'mae_fang',  name: 'อ่างเก็บน้ำแม่ฝาง',   capacity_mcm:  48 },
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

// ── River water levels — thaiwater.net public API ─────────────────────────────
app.get('/api/water-levels', async (_req, res) => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');

  const results = await Promise.allSettled(
    RIVER_STATIONS.map(async st => {
      const url = `https://api.thaiwater.net/api/v1/thaiwater/api/public/waterlevel_report?station_id=${encodeURIComponent(st.id)}&YYYY=${y}&MM=${m}&DD=${d}`;
      try {
        const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 6000);
        if (!r.ok) return { ...st, level: null, status: 'offline' };
        const json = await r.json();
        const latest = json?.result?.[0] ?? json?.data?.[0] ?? json?.[0] ?? null;
        const level   = parseFloat(latest?.water_level ?? latest?.wl ?? latest?.msl) || null;
        const warn    = parseFloat(latest?.warning_level) || null;
        const crit    = parseFloat(latest?.critical_level) || null;
        return { ...st, level, warning_level: warn, critical_level: crit, status: level != null ? 'online' : 'nodata' };
      } catch {
        return { ...st, level: null, status: 'error' };
      }
    })
  );

  res.json(results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { ...RIVER_STATIONS[i], level: null, status: 'error' }
  ));
});

// ── Dam levels — thaiwater.net reservoir API ──────────────────────────────────
app.get('/api/dams', async (_req, res) => {
  const results = await Promise.allSettled(
    DAM_META.map(async dam => {
      const url = `https://api.thaiwater.net/api/v1/thaiwater/api/public/reservoir_daily?dam_id=${dam.code}`;
      try {
        const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 6000);
        if (!r.ok) return { ...dam, current_mcm: null, percent: null, inflow: null, outflow: null, status: 'offline' };
        const json = await r.json();
        const latest  = json?.result?.[0] ?? json?.data?.[0] ?? json?.[0] ?? null;
        const current = parseFloat(latest?.storage ?? latest?.volume ?? latest?.dam_storage) || null;
        const inflow  = parseFloat(latest?.inflow) || null;
        const outflow = parseFloat(latest?.outflow ?? latest?.release) || null;
        const percent = current ? Math.min(Math.round((current / dam.capacity_mcm) * 100), 110) : null;
        return { ...dam, current_mcm: current, percent, inflow, outflow, status: 'online' };
      } catch {
        return { ...dam, current_mcm: null, percent: null, inflow: null, outflow: null, status: 'error' };
      }
    })
  );

  res.json(results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { ...DAM_META[i], current_mcm: null, percent: null, status: 'error' }
  ));
});

// ── Emergency facilities — OSM Overpass (cached 1 hr) ────────────────────────
app.get('/api/shelters', async (_req, res) => {
  if (shelterCache.data && Date.now() - shelterCache.ts < SHELTER_TTL) {
    return res.json(shelterCache.data);
  }
  const query = `[out:json][timeout:25];
(
  node["amenity"="hospital"](19.2,99.5,20.6,100.5);
  way["amenity"="hospital"](19.2,99.5,20.6,100.5);
  node["amenity"="fire_station"](19.2,99.5,20.6,100.5);
  node["amenity"="shelter"](19.2,99.5,20.6,100.5);
  node["emergency"="assembly_point"](19.2,99.5,20.6,100.5);
  node["amenity"="police"](19.2,99.5,20.6,100.5);
);
out center;`;

  try {
    const r = await fetchWithTimeout(
      'https://overpass-api.de/api/interpreter',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` },
      28000
    );
    if (!r.ok) return res.status(502).json({ error: `Overpass ${r.status}` });
    const json = await r.json();
    const shelters = (json.elements ?? [])
      .map(el => ({
        id:   el.id,
        name: el.tags?.['name:th'] ?? el.tags?.name ?? el.tags?.amenity ?? 'สถานที่ฉุกเฉิน',
        type: el.tags?.amenity ?? el.tags?.emergency ?? 'shelter',
        lat:  el.lat ?? el.center?.lat,
        lon:  el.lon ?? el.center?.lon,
      }))
      .filter(s => s.lat && s.lon);
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

// ── ML flood risk scores — proposal formula with Chiang Rai data ──────────────
app.get('/api/route-risk', async (_req, res) => {
  const [weather, traffic] = await Promise.all([fetchLiveWeather(), fetchLiveTraffic()]);

  // Fetch all Chiang Rai river stations in parallel
  const today = new Date();
  const y = today.getFullYear(), m = String(today.getMonth()+1).padStart(2,'0'), d = String(today.getDate()).padStart(2,'0');

  const stationFetches = await Promise.allSettled(
    RIVER_STATIONS.map(async st => {
      const url = `https://api.thaiwater.net/api/v1/thaiwater/api/public/waterlevel_report?station_id=${encodeURIComponent(st.id)}&YYYY=${y}&MM=${m}&DD=${d}`;
      const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 5000);
      if (!r.ok) return null;
      const json = await r.json();
      const latest = json?.result?.[0] ?? json?.data?.[0] ?? json?.[0] ?? null;
      const level = parseFloat(latest?.water_level ?? latest?.wl ?? latest?.msl) || null;
      const warn  = parseFloat(latest?.warning_level) || null;
      return level != null ? { id: st.id, level, warning_level: warn } : null;
    })
  );
  const waterLevels = stationFetches
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean);

  const damFetches = await Promise.allSettled(
    DAM_META.map(async dam => {
      const r = await fetchWithTimeout(
        `https://api.thaiwater.net/api/v1/thaiwater/api/public/reservoir_daily?dam_id=${dam.code}`,
        { headers: { Accept: 'application/json' } }, 5000
      );
      if (!r.ok) return null;
      const json = await r.json();
      const latest = json?.result?.[0] ?? json?.data?.[0] ?? json?.[0] ?? null;
      const current = parseFloat(latest?.storage ?? latest?.volume ?? latest?.dam_storage) || null;
      const percent = current ? Math.min(Math.round((current / dam.capacity_mcm) * 100), 110) : null;
      return percent != null ? { code: dam.code, percent } : null;
    })
  );
  const damLevels = damFetches
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean);

  const result = {};
  for (const id of ['A', 'B', 'C']) {
    result[id] = predictRouteRisk(
      id,
      weather,
      waterLevels.length ? waterLevels : null,
      damLevels.length   ? damLevels   : null,
      traffic
    );
  }
  res.json(result);
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
    const { lat, lon, date, hour, duration } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });

    const url = `https://data.tmd.go.th/nwpapi/v1/forecast/hourly/at?lat=${lat}&lon=${lon}&fields=tc,rh,rr,ws,wd,cond&date=${date || new Date().toISOString().slice(0, 10)}&hour=${hour ?? new Date().getHours()}&duration=${duration || 6}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${TMD_TOKEN}`, 'Accept': 'application/json' },
    });

    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : { error: await response.text() };

    if (!response.ok) {
      console.warn(`TMD API error: ${response.status}`);
      return res.status(502).json({ error: `TMD upstream error: ${response.status}`, data });
    }
    res.json(data);
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
    if (weather?.rr != null && weather.rr > 15) alert_level = Math.max(alert_level, 2);

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

// GISTDA Open Data Flood proxy (to bypass frontend CORS restrictions)
app.get('/api/gistda/flood', async (_req, res) => {
  try {
    const dataKey = process.env.VITE_GISTDA_DATA_KEY || '756xL1gEPprZgJXwBdZxyorZ48GbuSmgDC576gqwuNTTCqcawOtgjAo6JKXpfTtK';
    const response = await fetch(`https://api.sphere.gistda.or.th/services/info/disaster-flood?key=${dataKey}`);
    if (!response.ok) throw new Error(`GISTDA API returned HTTP ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('GISTDA Flood proxy error:', error.message);
    res.status(502).json({ error: 'Failed to fetch GISTDA flood data from remote source.' });
  }
});

// ── SAR flood GeoJSON — static pre-processed Chiang Rai flood polygons ────────
// Source: CEMS/GISTDA Sentinel-1A IW GRD VV+VH analysis (2024 flood season)
app.get('/api/sar/flood', (_req, res) => {
  const geojson = {
    type: 'FeatureCollection',
    metadata: { source: 'Sentinel-1A SAR (IW GRD)', province: 'เชียงราย', updated: '2024-09-15' },
    features: [
      {
        type: 'Feature',
        properties: { district: 'แม่สาย', depth_m: 2.1, area_km2: 4.8, severity: 0.92 },
        geometry: {
          type: 'Polygon',
          coordinates: [[[99.860,20.420],[99.900,20.420],[99.910,20.445],[99.875,20.450],[99.855,20.435],[99.860,20.420]]],
        },
      },
      {
        type: 'Feature',
        properties: { district: 'เวียงป่าเป้า', depth_m: 1.8, area_km2: 3.2, severity: 0.88 },
        geometry: {
          type: 'Polygon',
          coordinates: [[[99.840,19.360],[99.875,19.360],[99.880,19.390],[99.845,19.395],[99.835,19.375],[99.840,19.360]]],
        },
      },
      {
        type: 'Feature',
        properties: { district: 'เมืองเชียงราย', depth_m: 0.9, area_km2: 1.5, severity: 0.60 },
        geometry: {
          type: 'Polygon',
          coordinates: [[[99.820,19.895],[99.850,19.895],[99.855,19.920],[99.825,19.922],[99.815,19.908],[99.820,19.895]]],
        },
      },
      {
        type: 'Feature',
        properties: { district: 'เทิง', depth_m: 1.2, area_km2: 2.1, severity: 0.65 },
        geometry: {
          type: 'Polygon',
          coordinates: [[[100.055,19.965],[100.090,19.965],[100.095,19.988],[100.060,19.992],[100.050,19.975],[100.055,19.965]]],
        },
      },
    ],
  };
  res.json(geojson);
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
    return `เส้นทาง ${r.id}: ความเสี่ยง ${r.risk}% | FloodDepth ${((f.f_flood_depth ?? 0) * 100).toFixed(0)}% | DepthTrend ${((f.f_depth_trend ?? 0) * 100).toFixed(0)}% | HistoricalIncident ${((f.f_historical ?? 0) * 100).toFixed(0)}% | SoilRisk ${((f.f_soil ?? 0) * 100).toFixed(0)}%`;
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

// ── Human Override — record officer decision to in-memory audit log ────────────
const overrideLog = [];

app.post('/api/override', (req, res) => {
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
  if (overrideLog.length > 100) overrideLog.pop();  // keep last 100
  console.log(`[OVERRIDE] ${record.id} — ${officer} selected route ${routeId}: ${reason}`);
  res.json({ success: true, record });
});

app.get('/api/override/log', (_req, res) => {
  res.json(overrideLog);
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
  console.log(`📡 SAR flood:    /api/sar/flood`);
  console.log(`🌀 AI chat:      /api/ai/chat`);
  console.log(`🌀 AI briefing:  /api/ai/briefing`);
  console.log(`🔍 XAI explain:  POST /api/explain`);
  console.log(`✋ Override:     POST /api/override\n`);
});

export default app;
