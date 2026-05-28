"""
แปลง LDD Soil shapefile จ.เชียงราย → data/soil_polygons.json
รันครั้งเดียว จากนั้น server.js โหลดใช้โดยตรง ไม่ต้องรัน Python อีก

Formula: risk = 0.6 × drainage_risk(soilseries) + 0.4 × texture_risk(texture_to)
JSON format: { risk, bbox, coords, holes }  — holes = list of interior rings

Run: python3 scripts/export_soil_polygons.py
"""

import json
from pathlib import Path
from collections import Counter
import pandas as pd
import geopandas as gpd

ROOT = Path(__file__).parent.parent
SHP  = ROOT / "sr_cri_extracted/เชียงราย/Soil_เชียงราย/Soil_จ.เชียงราย.shp"
OUT  = ROOT / "data/soil_polygons.json"

SIMPLIFY_M = 50  # tolerance เมตร (ใน UTM47N ก่อน to_crs 4326)

# ── Drainage-class risk (0=ระบายดีมาก … 1=น้ำขัง) ─────────────────────────────
# ค่า flood-risk จาก drainage capacity ของ soil series จ.เชียงราย (LDD 2561)
# Poor/very-poor drainage → high risk; well/excessively drained → low risk
DRAINAGE_RISK = {
    # Water bodies / marsh
    "W":    0.92,
    "MARSH":0.92,
    # Poorly drained — lowland/depression soils
    "Rk":   0.80,   # ร้อยเอ็ด: poorly drained alluvial
    "Wt":   0.78,   # วัดท่าสุ: poorly drained
    "Ch":   0.72,   # เชียงคำ: imperfectly to poorly drained valley soil
    "Kk":   0.70,   # ขอนแก่น: poorly drained
    "Mk":   0.68,   # แม่กก: imperfectly drained alluvial terrace
    "Mc":   0.66,   # แม่จัน: imperfectly drained alluvial
    # Imperfectly drained
    "Cr":   0.58,   # เชียงราย: imperfectly drained (ดินร่วนเหนียวปนทรายแป้ง)
    "Wf":   0.55,   # เวียงฝาง: moderately to imperfectly drained
    "Ct":   0.55,   # เชียงแสน: imperfectly drained terrace
    "Pk":   0.52,   # พะเยา: moderately drained terrace
    # Moderately drained
    "Wch":  0.50,   # เวียงชัย: moderate (ดินร่วนเหนียวปนทรายแป้ง)
    "Ws":   0.50,   # วังสะพุง: moderate (ดินร่วนปนดินเหนียว)
    "Mn":   0.48,   # แม่น้ำน้อย: moderately drained
    "Pp":   0.48,   # พาน: moderately well drained alluvial
    "Pa":   0.45,   # พะเยา แดง: moderately well drained
    "Nd":   0.45,   # เชียงดาว: moderately well drained
    # Moderately-well drained
    "Tl":   0.40,   # ท่าลี่: mod-well (ดินร่วนเหนียวปนกรวด)
    "Ms":   0.38,   # แม่สุ่ย: moderately well drained upland
    "Ps":   0.38,   # ป่าซาง: moderately well drained
    "Cm":   0.35,   # แม่แจ่ม: well drained hillside
    # Well drained — upland / hillside
    "Sp":   0.35,   # สันป่าตอง: well drained (ดินร่วนปนทราย)
    "CnB":  0.28,   # เชียงดาวลาดเอียง B: well drained
    "CnC":  0.26,   # เชียงดาวลาดเอียง C
    "CnD":  0.24,   # เชียงดาวลาดเอียง D (ชันมาก)
    "MsB":  0.30,
    "MsC":  0.28,
    "PaB":  0.30,
    "PaC":  0.28,
    "Ty":   0.32,   # ท่ายาง: well drained gravelly soil
    "Su":   0.30,   # สุรินทร์: well drained (ดินร่วนเหนียวปนกรวด)
    "Rg":   0.20,   # ดินร่วนกรวด บนเนิน: well to excessively drained
    "Sk":   0.20,   # หินพื้น/skeletal: drainage irrelevant → low risk
}
DEFAULT_DRAINAGE = 0.50  # fallback สำหรับ series ที่ไม่รู้จัก

# ── Texture risk (permeability proxy) ──────────────────────────────────────────
TEXTURE_RISK = {
    "ดินทรายปนดินร่วน":               0.20,
    "ดินร่วนปนทราย":                   0.25,
    "ดินร่วนปนทรายปนกรวด":            0.22,
    "ดินร่วน":                          0.40,
    "ดินร่วนปนทรายแป้ง":               0.45,
    "ดินร่วนเหนียวปนทราย":             0.55,
    "ดินร่วนเหนียวปนทรายแป้ง":        0.60,
    "ดินร่วนเหนียวปนกรวด":             0.50,
    "ดินร่วนเหนียวปนทรายปนกรวด":     0.52,
    "ดินร่วนปนดินเหนียว":              0.65,
}
DEFAULT_TEXTURE = 0.50

MARSH_RISK = 0.92  # น้ำ/พรุ → risk สูงสุด

def get_risk(row) -> float:
    series = str(row["soilseries"]).strip() if pd.notna(row["soilseries"]) else ""
    if series in ("W", "MARSH"):
        return MARSH_RISK
    d_risk = DRAINAGE_RISK.get(series, DEFAULT_DRAINAGE)
    tex    = str(row["texture_to"]).strip() if pd.notna(row["texture_to"]) else ""
    t_risk = TEXTURE_RISK.get(tex, DEFAULT_TEXTURE)
    return round(0.6 * d_risk + 0.4 * t_risk, 3)

def ring_to_coords(ring):
    return [[round(c[0], 6), round(c[1], 6)] for c in ring.coords]

def extract_polygons(geom, risk):
    """แยก MultiPolygon → list of {risk, bbox, coords, holes}"""
    polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    out = []
    for p in polys:
        if p.is_empty or not p.is_valid:
            continue
        coords = ring_to_coords(p.exterior)
        if len(coords) < 4:
            continue
        b = p.bounds
        entry = {
            "risk":   risk,
            "bbox":   [round(b[0], 6), round(b[1], 6), round(b[2], 6), round(b[3], 6)],
            "coords": coords,
        }
        # Include interior rings (holes) — 4.2% of polygon parts have them
        if p.interiors:
            holes = [ring_to_coords(h) for h in p.interiors if len(list(h.coords)) >= 4]
            if holes:
                entry["holes"] = holes
        out.append(entry)
    return out

def main():
    print(f"Loading: {SHP}")
    gdf = gpd.read_file(SHP, encoding="cp874")
    orig_crs = gdf.crs
    print(f"  {len(gdf)} polygons, original CRS: {orig_crs}")

    # Project to UTM47N for metre-based simplify, then reproject to WGS84
    print(f"  Reprojecting to EPSG:32647 for simplify...")
    gdf = gdf.to_crs("EPSG:32647")
    print(f"  Simplifying to {SIMPLIFY_M}m tolerance...")
    gdf["geometry"] = gdf.geometry.simplify(SIMPLIFY_M, preserve_topology=True)
    print(f"  Reprojecting to EPSG:4326 (WGS84)...")
    gdf = gdf.to_crs("EPSG:4326")

    # Compute combined risk
    gdf["risk"] = gdf.apply(get_risk, axis=1)

    # Extract polygon rings + holes
    print("  Extracting polygon rings...")
    polygons = []
    for _, row in gdf.iterrows():
        g = row.geometry
        if g is None or g.is_empty:
            continue
        polygons.extend(extract_polygons(g, row["risk"]))

    # ── Stats ───────────────────────────────────────────────────────────────────
    total_v    = sum(len(p["coords"]) + sum(len(h) for h in p.get("holes", [])) for p in polygons)
    with_holes = sum(1 for p in polygons if "holes" in p)
    total_holes= sum(len(p["holes"]) for p in polygons if "holes" in p)
    risks      = [p["risk"] for p in polygons]
    risk_counts= Counter(round(r, 2) for r in risks)

    print(f"\n── Export report ──────────────────────────────────────")
    print(f"  Original CRS:  {orig_crs}")
    print(f"  Rings:         {len(polygons)}")
    print(f"  Rings w/ holes:{with_holes} ({with_holes/len(polygons)*100:.1f}%) — {total_holes} total holes")
    print(f"  Vertices:      {total_v:,} (exterior + holes)")
    print(f"  Risk  min={min(risks):.3f}  max={max(risks):.3f}  mean={sum(risks)/len(risks):.3f}")
    print(f"  Risk distribution (rounded to 2dp):")
    for v, cnt in sorted(risk_counts.items()):
        print(f"    {v:.2f}: {cnt}")

    output = {
        "source":       "LDD Soil Survey จ.เชียงราย 1:25,000 (2561)",
        "original_crs": str(orig_crs),
        "simplify":     f"{SIMPLIFY_M}m tolerance (EPSG:32647)",
        "formula":      "0.6*drainage_risk(soilseries) + 0.4*texture_risk(texture_to)",
        "crs":          "EPSG:4326",
        "polygons":     polygons,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    size_mb = OUT.stat().st_size / 1024 / 1024
    print(f"\n✓ Written to {OUT}  ({size_mb:.1f} MB, {len(polygons)} rings)")

if __name__ == "__main__":
    main()
