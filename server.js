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
const PORT = 3001;

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

// ดึงอากาศจริงจาก TMD (server-side ไม่มี CORS)
const fetchLiveWeather = async () => {
  try {
    const lat = 18.788, lon = 98.985;
    const date = new Date().toISOString().slice(0, 10);
    const hour = new Date().getHours();
    const url = `https://data.tmd.go.th/nwpapi/v1/forecast/hourly/at?lat=${lat}&lon=${lon}&fields=tc,rh,rr,ws,wd,cond&date=${date}&hour=${hour}&duration=1`;
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

// ดึงข้อมูลจราจรจริงจาก Supabase (only valid-speed detections for avg)
const fetchLiveTraffic = async () => {
  if (!supabase) return null;
  try {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: detections, error } = await supabase
      .from('detections')
      .select('camera_id,extra')
      .gte('timestamp', since);
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
      else if (avg_speed < 20 && r.count > 0) congestion_level = 'warning';
      summary[id] = { vehicle_count: r.count, avg_speed, congestion_level, stopped_ratio };
    });
    return summary;
  } catch (err) {
    console.error('Supabase traffic error:', err.message);
    return null;
  }
};


// ── ML Risk Model ─────────────────────────────────────────────────────────────
// Feature weights calibrated from Chiang Mai flood geography:
//   water_exposure  — how much the route crosses low-lying flood plains
//   rain_lag        — rainfall accumulation sensitivity (drainage quality)
//   dam_pressure    — downstream effect when dam nears capacity
//   traffic_signal  — CCTV-detected congestion as road-condition proxy
const ROUTE_WEIGHTS = {
  A: { water_exposure: 0.25, rain_lag: 0.35, dam_pressure: 0.20, traffic_signal: 0.20 },
  B: { water_exposure: 0.45, rain_lag: 0.30, dam_pressure: 0.35, traffic_signal: 0.25 },
  C: { water_exposure: 0.85, rain_lag: 0.55, dam_pressure: 0.55, traffic_signal: 0.30 },
};

const sigmoid = x => 1 / (1 + Math.exp(-x));

/**
 * Compute flood risk score [0–99] for a single route.
 * Returns { risk, depth_est, confidence, features }
 */
const predictRouteRisk = (routeId, weather, waterLevels, damLevels, traffic) => {
  const w = ROUTE_WEIGHTS[routeId];

  // f1: rainfall intensity  (0–1, saturates at 25 mm/hr)
  const f_rain = Math.min((weather?.rr ?? 0) / 25, 1);

  // f2: river level ratio   (avg current/warning across stations)
  const f_water = waterLevels?.length
    ? waterLevels.reduce((s, st) => {
        const ratio = (st.level != null && st.warning_level)
          ? st.level / st.warning_level : 0.3;
        return s + Math.min(ratio, 1.5);
      }, 0) / waterLevels.length
    : 0.3;

  // f3: dam fill pressure   (avg %, high = flood-release risk)
  const f_dam = damLevels?.length
    ? damLevels.reduce((s, d) => s + Math.min((d.percent ?? 50) / 100, 1.1), 0) / damLevels.length
    : 0.5;

  // f4: traffic congestion proxy
  const cong = traffic?.[routeId]?.congestion_level;
  const f_traffic = cong === 'blocked' ? 1.0 : cong === 'warning' ? 0.5 : 0.15;

  // Weighted sum → shift to sigmoid range → scale to [0, 99]
  const raw = w.water_exposure * f_water
            + w.rain_lag       * f_rain
            + w.dam_pressure   * f_dam
            + w.traffic_signal * f_traffic;

  const risk  = Math.min(Math.round(sigmoid(raw * 5 - 2.2) * 99), 99);
  const depth = Math.max(0.05, (risk / 65)).toFixed(2);  // rough depth estimate

  // Data completeness → confidence
  const sources = [weather, waterLevels, damLevels, traffic].filter(Boolean).length;
  const confidence = Math.round((sources / 4) * 100);

  return {
    risk,
    depth_est: parseFloat(depth),
    confidence,
    features: { f_rain: +f_rain.toFixed(3), f_water: +f_water.toFixed(3), f_dam: +f_dam.toFixed(3), f_traffic },
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
    ? `A เสี่ยง ${routeRisks.A ?? '-'}%, B เสี่ยง ${routeRisks.B ?? '-'}%, C เสี่ยง ${routeRisks.C ?? '-'}%`
    : 'ไม่มีข้อมูล OSRM';
  return `[อากาศ TMD]: ${wStr}\n[จราจร CCTV]: ${tStr}\n[ความเสี่ยงน้ำท่วม OSRM]: ${rStr}`;
};

// ── External data metadata ────────────────────────────────────────────────────

const RIVER_STATIONS = [
  { id: 'P.1',  name: 'แม่น้ำปิง เมืองเชียงใหม่', lat: 18.788, lon: 99.003 },
  { id: 'P.67', name: 'แม่น้ำแม่แตง บ.เกาะหลวง',  lat: 19.090, lon: 98.942 },
  { id: 'P.75', name: 'แม่น้ำปิง บ.ห้วยทราย',     lat: 19.045, lon: 98.935 },
  { id: 'M.2',  name: 'แม่น้ำกวง บ.สันกำแพง',     lat: 18.745, lon: 99.115 },
];

const DAM_META = [
  { code: 'mae_ngat',  name: 'เขื่อนแม่งัดสมบูรณ์ชล', capacity_mcm: 265 },
  { code: 'mae_kuang', name: 'เขื่อนแม่กวงอุดมธารา',   capacity_mcm: 263 },
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
  node["amenity"="hospital"](18.6,98.8,19.2,99.2);
  way["amenity"="hospital"](18.6,98.8,19.2,99.2);
  node["amenity"="fire_station"](18.6,98.8,19.2,99.2);
  node["amenity"="shelter"](18.6,98.8,19.2,99.2);
  node["emergency"="assembly_point"](18.6,98.8,19.2,99.2);
  node["amenity"="police"](18.6,98.8,19.2,99.2);
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
      `https://data.tmd.go.th/api/v1/warnings?province=เชียงใหม่&type=json`,
      { headers: { Authorization: `Bearer ${TMD_TOKEN}`, Accept: 'application/json' } },
      8000
    );
    if (!r.ok) return res.status(502).json({ error: `TMD warnings: ${r.status}` });
    res.json(await r.json());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// ── ML flood risk scores — weighted feature model ─────────────────────────────
app.get('/api/route-risk', async (_req, res) => {
  const [weather, traffic] = await Promise.all([fetchLiveWeather(), fetchLiveTraffic()]);

  let waterLevels = null;
  let damLevels   = null;

  try {
    const today = new Date();
    const y = today.getFullYear(), m = String(today.getMonth()+1).padStart(2,'0'), d = String(today.getDate()).padStart(2,'0');
    const r = await fetchWithTimeout(
      `https://api.thaiwater.net/api/v1/thaiwater/api/public/waterlevel_report?station_id=P.1&YYYY=${y}&MM=${m}&DD=${d}`,
      { headers: { Accept: 'application/json' } }, 5000
    );
    if (r.ok) {
      const json = await r.json();
      const latest = json?.result?.[0] ?? json?.data?.[0] ?? json?.[0] ?? null;
      const level = parseFloat(latest?.water_level ?? latest?.wl ?? latest?.msl) || null;
      const warn  = parseFloat(latest?.warning_level) || null;
      if (level != null) waterLevels = [{ id: 'P.1', level, warning_level: warn }];
    }
  } catch (_) {}

  try {
    const r = await fetchWithTimeout(
      `https://api.thaiwater.net/api/v1/thaiwater/api/public/reservoir_daily?dam_id=mae_ngat`,
      { headers: { Accept: 'application/json' } }, 5000
    );
    if (r.ok) {
      const json = await r.json();
      const latest = json?.result?.[0] ?? json?.data?.[0] ?? json?.[0] ?? null;
      const current = parseFloat(latest?.storage ?? latest?.volume ?? latest?.dam_storage) || null;
      const percent = current ? Math.min(Math.round((current / 265) * 100), 110) : null;
      if (percent != null) damLevels = [{ code: 'mae_ngat', percent }];
    }
  } catch (_) {}

  const result = {};
  for (const id of ['A', 'B', 'C']) {
    result[id] = predictRouteRisk(id, weather, waterLevels, damLevels, traffic);
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

    const systemPrompt = `คุณคือ FloodNav AI ผู้ช่วยนำทางเลี่ยงน้ำท่วมสำหรับจังหวัดเชียงใหม่
ตอบภาษาไทย กระชับ ไม่เกิน 5 ประโยค อิงข้อมูลใน CONTEXT เท่านั้น ห้ามแต่งข้อมูลนอก CONTEXT
หากพบการรายงานภัย (น้ำท่วม/ดินถล่ม/สิ่งกีดขวาง) ให้ตอบรับและระบุว่ากำลังรัน addIncident()

[CONTEXT]
${context}`;

    // ตรวจจับ tool call จาก keyword
    let toolCall = null;
    const lower = message.toLowerCase();
    if (/ท่วม|หลาก|ถล่ม|ดินสไลด์|ขวาง|blocked|flood|landslide/i.test(message)) {
      let locationName = 'จุดเสี่ยงภัยฉุกเฉิน', lat = 18.79, lon = 98.99, depth = 1.2, severity = 0.8;
      if (lower.includes('กาดก้อม'))       { locationName = 'กาดก้อม';    lat = 18.775; lon = 98.988; }
      else if (lower.includes('ช้างคลาน')) { locationName = 'ช้างคลาน';  lat = 18.778; lon = 98.995; }
      else if (lower.includes('สถานีรถไฟ')){ locationName = 'สถานีรถไฟ'; lat = 18.785; lon = 99.015; }
      else if (lower.includes('ป่าตัน'))   { locationName = 'ป่าตัน';    lat = 18.815; lon = 98.995; }
      else if (lower.includes('แม่ริม'))   { locationName = 'อ.แม่ริม';  lat = 18.914; lon = 98.944; severity = 0.95; }
      else if (lower.includes('สันทราย'))  { locationName = 'อ.สันทราย'; lat = 18.850; lon = 99.040; }
      const depthMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:เมตร|ม\.|m)/);
      if (depthMatch) depth = parseFloat(depthMatch[1]);
      toolCall = { name: 'addIncident', arguments: { name: `${locationName} (แจ้งเตือนใหม่)`, lat, lon, depth, severity } };
    } else if (/จัดสรร|แบ่งเรือ|optimizer/i.test(message)) {
      toolCall = { name: 'optimizeAllocation', arguments: {} };
    }

    // ส่ง history จริงให้ Typhoon (multi-turn)
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
          content: 'คุณคือระบบสรุปสถานการณ์ภัยพิบัติเชียงใหม่ สรุป 3-4 ประโยคภาษาไทย ระบุเวลา สภาพอากาศ จราจร และแนะนำเส้นทาง อิง CONTEXT เท่านั้น',
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
  console.log(`\n🚀 FloodNav server on http://localhost:${PORT}`);
  console.log(`📡 TMD proxy:    /api/tmd/forecast`);
  console.log(`📡 CCTV traffic: /api/vehicles/route-summary`);
  console.log(`🌀 AI chat:      /api/ai/chat`);
  console.log(`🌀 AI briefing:  /api/ai/briefing\n`);
});

export default app;
