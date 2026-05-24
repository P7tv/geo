# FloodNav — API Documentation Reference

รวม docs ของทุก API ที่ระบบใช้ พร้อม endpoint จริงที่ใช้ใน `server.js` และสิ่งที่ต้องตรวจสอบ

---

## 1. TMD Weather Forecast API
**ใช้ใน:** `fetchLiveWeather()`, `GET /api/tmd/forecast`

| | |
|---|---|
| **Docs** | https://data.tmd.go.th/nwpapi/doc/ |
| **Base URL** | `https://data.tmd.go.th/nwpapi/v1` |
| **Auth** | Bearer Token (TMD_TOKEN ใน .env) |

**Endpoint ที่ใช้จริง:**
```
GET /forecast/hourly/at?lat=19.908&lon=99.832&fields=tc,rh,rr,ws,wd,cond&date=YYYY-MM-DD&hour=H&duration=1
```

**⚠️ ต้องตรวจสอบ:**
- ทดสอบตอนนี้ได้ผล `OFFLINE` — token อาจหมดอายุ (JWT exp ดูได้จาก [jwt.io](https://jwt.io))
- field `rr` = rainfall mm/hr ที่ใช้คำนวณ DepthTrend (0.25 weight) — ถ้า offline ค่าจะเป็น 0 ตลอด
- ต่ออายุ token ที่: https://data.tmd.go.th/nwpapi/doc/#section/Authentication

---

## 2. TMD Official Warnings API
**ใช้ใน:** `GET /api/warnings`

| | |
|---|---|
| **Docs** | https://data.tmd.go.th/nwpapi/doc/ (section Warnings) |
| **Base URL** | `https://data.tmd.go.th/api/v1` |
| **Auth** | Bearer Token (TMD_TOKEN เดียวกัน) |

**Endpoint ที่ใช้จริง:**
```
GET /warnings?province=เชียงราย&type=json
```

**⚠️ ต้องตรวจสอบ:**
- response structure: ใช้ `.warnings[0].description` หรือ `.data[0].warning` — ไม่แน่ใจ field ที่ถูกต้อง
- ทดสอบแล้วได้ `warnings: 0 entries` (อาจไม่มีประกาศจริง หรือ response format ต่างกัน)

---

## 3. Thai Water API (thaiwater.net v3)
**ใช้ใน:** `GET /api/water-levels`, `GET /api/dams`, `GET /api/route-risk`

| | |
|---|---|
| **Docs อ้างอิง** | https://standard.thaiwater.net/glossary/api-documentation/ |
| **Base URL จริง** | `https://api-v3.thaiwater.net/api/v1/thaiwater30/public` |
| **Station List** | `https://api-v3.thaiwater.net/api/v1/thaiwater30/frontend/shared/station_all` |
| **Auth** | ไม่ต้องการ (public API) |

> ⚠️ **api.thaiwater.net ล้าสมัย** — domain จริงที่ใช้งานได้คือ `api-v3.thaiwater.net`
> ค้นพบโดยการ reverse-engineer JS bundle ของ www.thaiwater.net

**Endpoints ที่ใช้จริง:**
```
GET /waterlevel_graph?station_type=tele_waterlevel&station_id={numeric_id}&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
GET /analyst/dam    (returns all 17 major dams, filter by dam.id)
GET /frontend/shared/station_all    (10,729 stations, province_code=57 คือเชียงราย)
```

**Response structure (waterlevel_graph):**
```json
{
  "data": {
    "graph_data": [{ "datetime": "2026-05-24 12:00", "value": 389.6, "discharge": 175 }],
    "min_bank": 392.5,        // ขอบตลิ่ง (masl) — ใช้เป็น warning threshold
    "warning_level": null,    // บางสถานีมีค่า
    "critical_level": null
  }
}
```

> **หมายเหตุ:** `value` คือ ระดับน้ำ meters above sea level (masl) ไม่ใช่ความลึกจากผิวน้ำ
> FloodDepth ที่แท้จริง = `value - ground_level` หรือใช้ `value / min_bank` เป็น ratio

**Station IDs เชียงราย (verified ✅):**

| station_id | old_code | แม่น้ำ/ที่ตั้ง | อำเภอ | สถานะข้อมูล |
|---|---|---|---|---|
| `1574191` | G.2A | แม่น้ำกก บ้านกกโท้ง | เมือง | ✅ มีข้อมูล, min_bank=392.5 |
| `6855760` | — | สะพานสบกก (กก-สาย) | เชียงแสน | ✅ มีข้อมูล |
| `3303` | Kh.89 | แม่น้ำจัน บ้านหัวสะพาน | แม่จัน | ✅ มีข้อมูล |
| `3301` | I.14 | แม่น้ำอิง บ้านน้ำอิง | ขุนตาล | ⚠️ มีบางส่วน |

**หมายเหตุเขื่อน:**
- thaiwater.net มีเฉพาะเขื่อนใหญ่ 17 แห่ง — **ไม่มีเขื่อนในเชียงราย**
- ใช้ **เขื่อนแม่งัด (id=53, lat=19.16)** เป็น upstream pressure proxy แทน
- Dam endpoint: `GET /analyst/dam` → filter `data.dam_hourly[].dam.id === 53`

---

## 4. Overpass API (OpenStreetMap)
**ใช้ใน:** `GET /api/shelters`

| | |
|---|---|
| **Docs** | https://wiki.openstreetmap.org/wiki/Overpass_API |
| **Docs (Language Guide)** | https://wiki.openstreetmap.org/wiki/Overpass_API/Language_Guide |
| **Base URL** | `https://overpass-api.de/api/interpreter` |
| **Auth** | ไม่ต้องการ (rate limited) |

**Query ที่ใช้จริง (bbox เชียงราย):**
```
[out:json][timeout:25];
(
  node["amenity"="hospital"](19.2,99.5,20.6,100.5);
  way["amenity"="hospital"](19.2,99.5,20.6,100.5);
  node["amenity"="fire_station"](19.2,99.5,20.6,100.5);
  node["amenity"="shelter"](19.2,99.5,20.6,100.5);
  node["emergency"="assembly_point"](19.2,99.5,20.6,100.5);
  node["amenity"="police"](19.2,99.5,20.6,100.5);
);
out center;
```

**⚠️ ต้องตรวจสอบ:**
- ทดสอบแล้วได้ 1 facility — bbox `(19.2, 99.5, 20.6, 100.5)` อาจแคบเกินไป
- ทดสอบ query ก่อนได้ที่ https://overpass-turbo.eu/

---

## 5. GISTDA Sphere Map SDK
**ใช้ใน:** `SphereMap` component ใน `src/App.jsx`

| | |
|---|---|
| **Docs** | https://sphere.gistda.or.th/docs/ |
| **SDK URL** | `https://api.sphere.gistda.or.th/map/?key=VITE_GISTDA_MAP_KEY` |
| **Auth** | API Key (VITE_GISTDA_MAP_KEY ใน .env) |

**Class ที่ใช้จริง:**
```js
new window.sphere.Map({ placeholder, center, zoom })
new window.sphere.Marker({ lon, lat }, { title, icon: { html } })
new window.sphere.Polyline(coords, { lineColor, lineWidth })
new window.sphere.Circle({ lon, lat }, radius, { lineColor, fillColor })
new window.sphere.Polygon(pts, { lineColor, fillColor })
mapInstance.Overlays.add(overlay)
mapInstance.Overlays.remove(overlay)
```

**⚠️ ต้องตรวจสอบ:**
- Map center ปัจจุบัน: `{ lon: 99.832, lat: 19.908 }` (เมืองเชียงราย) ✅
- API Key หมดอายุหรือไม่ — ตรวจสอบกับ GISTDA portal

---

## 6. GISTDA Disaster / Flood Open API
**ใช้ใน:** `GET /api/gistda/flood`

| | |
|---|---|
| **Docs** | https://disaster.gistda.or.th/services/open-api |
| **Base URL** | `https://api.sphere.gistda.or.th/services/info` |
| **Auth** | API Key (VITE_GISTDA_DATA_KEY ใน .env) |

**Endpoint ที่ใช้จริง:**
```
GET /disaster-flood?key=VITE_GISTDA_DATA_KEY
```

**⚠️ ต้องตรวจสอบ:**
- Response ไม่มีข้อมูลเชียงราย (0 points) — ตรวจสอบ:
  1. field ชื่อ province ใช้ `province`, `province_name`, หรืออื่น?
  2. ค่าอาจเป็น `"เชียงราย"` หรือ `"Chiang Rai"` หรือ province code?
  3. ดูตัวอย่าง response จริงใน docs แล้วปรับ filter ใน `fetchGistdaFloodData()`

---

## 7. OSRM Route API
**ใช้ใน:** `fetchRealRoutes()` ใน `src/App.jsx`

| | |
|---|---|
| **Docs** | https://project-osrm.org/docs/v5.5.1/api/ |
| **Base URL** | `https://router.project-osrm.org` |
| **Auth** | ไม่ต้องการ (public, rate limited) |

**Endpoint ที่ใช้จริง:**
```
GET /route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson
```

**Routes ปัจจุบัน (เชียงราย):**
| Route | จาก | ถึง |
|---|---|---|
| A | 99.832, 19.908 (เมือง) | 99.882, 20.434 (แม่สาย) |
| B | 99.832, 19.908 (เมือง) | 100.074, 19.977 (เทิง) |
| C | 99.832, 19.908 (เมือง) | 99.858, 19.375 (เวียงป่าเป้า) |

**⚠️ ต้องตรวจสอบ:**
- OSRM ไม่มี flood weight — เส้นทางเป็นแค่ shortest path ทั่วไป
- สำหรับ production ควรใช้ A* พร้อม flood cost ตาม proposal

---

## 8. Supabase JavaScript Client
**ใช้ใน:** `fetchLiveTraffic()`, CCTV detections ใน `server.js`

| | |
|---|---|
| **Docs** | https://supabase.com/docs/reference/javascript/introduction |
| **Dashboard** | https://supabase.com/dashboard |
| **Auth** | SUPABASE_URL + SUPABASE_ANON_KEY ใน .env |

**Query ที่ใช้จริง:**
```js
supabase
  .from('detections')
  .select('camera_id, extra')
  .gte('timestamp', since)
  .limit(500)
```

**Schema ที่ต้องมีใน Supabase:**
| Table | Column | Type | หมายเหตุ |
|---|---|---|---|
| `detections` | `camera_id` | text | `cam_01`, `cam_02`, `cam_03`, `cam_04` |
| `detections` | `timestamp` | timestamptz | เวลาตรวจจับ |
| `detections` | `extra` | jsonb | `{ speed: number, route_id: string }` |

**⚠️ ต้องตรวจสอบ:**
- ทดสอบแล้วได้ 0 records — table ว่างหรือยังไม่มี Jetson ส่งข้อมูล
- ตรวจสอบ Table schema ที่ Supabase Dashboard → Table Editor → `detections`
- ถ้าต้องการ mock data ใส่ผ่าน Supabase Dashboard → SQL Editor

---

## สรุปสถานะ API ทั้งหมด

| API | สถานะ | ปัญหาหลัก |
|---|---|---|
| TMD Weather | 🔴 OFFLINE | Token อาจหมดอายุ |
| TMD Warnings | 🟡 Online แต่ว่าง | Response format ไม่ตรง |
| thaiwater.net water | 🔴 OFFLINE | Station ID ผิดทั้งหมด |
| thaiwater.net dam | 🔴 OFFLINE | Dam code ผิดทั้งหมด |
| Overpass (shelters) | 🟡 1 facility | Bbox หรือ tag อาจแคบเกิน |
| GISTDA Sphere Map | 🟢 ใช้งานได้ | — |
| GISTDA Flood Data | 🟡 Online แต่ 0 pts | Filter province ไม่ตรง |
| OSRM | 🟢 ใช้งานได้ | ไม่มี flood weight |
| Supabase | 🟢 Connected | Table ว่าง ยังไม่มี Jetson |
