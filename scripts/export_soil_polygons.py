"""
แปลง LDD Soil shapefile จ.เชียงราย → data/soil_polygons.json
รันครั้งเดียว จากนั้น server.js โหลดใช้โดยตรง ไม่ต้องรัน Python อีก

Run: python3 scripts/export_soil_polygons.py
"""

import json
from pathlib import Path
import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon

ROOT = Path(__file__).parent.parent
SHP  = ROOT / "sr_cri_extracted/เชียงราย/Soil_เชียงราย/Soil_จ.เชียงราย.shp"
OUT  = ROOT / "data/soil_polygons.json"

SIMPLIFY_M = 50  # tolerance เมตร (ใน UTM47N)

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
DEFAULT_RISK = 0.50
MARSH_RISK   = 0.92

def get_risk(row) -> float:
    if str(row["soilseries"]) in ("W", "MARSH"):
        return MARSH_RISK
    tex = str(row["texture_to"]).strip() if row["texture_to"] else ""
    return TEXTURE_RISK.get(tex, DEFAULT_RISK)

def ring_to_coords(ring):
    return [[round(c[0], 6), round(c[1], 6)] for c in ring.coords]

def extract_polygons(geom, risk):
    """แยก MultiPolygon → list of {risk, bbox, coords}"""
    polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    out = []
    for p in polys:
        if p.is_empty or not p.is_valid:
            continue
        coords = ring_to_coords(p.exterior)
        if len(coords) < 4:
            continue
        b = p.bounds  # (minx, miny, maxx, maxy)
        out.append({
            "risk":   risk,
            "bbox":   [round(b[0], 6), round(b[1], 6), round(b[2], 6), round(b[3], 6)],
            "coords": coords,
        })
    return out

def main():
    print(f"Loading: {SHP}")
    gdf = gpd.read_file(SHP, encoding="cp874")
    print(f"  {len(gdf)} polygons, CRS: {gdf.crs}")

    # Simplify ใน UTM47N (metres) แล้วแปลงเป็น WGS84
    print(f"  Simplifying to {SIMPLIFY_M}m tolerance...")
    gdf["geometry"] = gdf.geometry.simplify(SIMPLIFY_M, preserve_topology=True)
    gdf = gdf.to_crs("EPSG:4326")

    # Map risk
    gdf["risk"] = gdf.apply(get_risk, axis=1)

    # แยก polygon แต่ละชิ้นออกมา
    print("  Extracting polygon rings...")
    polygons = []
    for _, row in gdf.iterrows():
        g = row.geometry
        if g is None or g.is_empty:
            continue
        polygons.extend(extract_polygons(g, row["risk"]))

    print(f"  Total rings: {len(polygons)}")

    # บีบ size โดยดู vertex count
    total_v = sum(len(p["coords"]) for p in polygons)
    print(f"  Total vertices: {total_v:,}")

    output = {
        "source":   "LDD Soil Survey จ.เชียงราย 1:25,000 (2561)",
        "simplify": f"{SIMPLIFY_M}m tolerance (EPSG:32647)",
        "crs":      "EPSG:4326",
        "polygons": polygons,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    size_mb = OUT.stat().st_size / 1024 / 1024
    print(f"\n✓ Written to {OUT}  ({size_mb:.1f} MB, {len(polygons)} rings)")

if __name__ == "__main__":
    main()
