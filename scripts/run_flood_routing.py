"""
FloodNav — A* Flood-Aware Routing — เชียงราย
Reads chiang_rai.osm.pbf → builds graph → runs A* → exports flood_routes.geojson
"""

import osmnx as ox
import networkx as nx
import numpy as np
import json
import math
import pickle
import os
import requests

ROOT        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PBF_FILE    = os.path.join(ROOT, 'chiang_rai.osm.pbf')
OSM_FILE    = os.path.join(ROOT, 'chiang_rai.osm')
GRAPH_CACHE = os.path.join(ROOT, 'chiang_rai_graph.pkl')
OUTPUT      = os.path.join(ROOT, 'data/flood_routes.geojson')
FLOODNAV    = 'http://localhost:3001/api'

RIVER_STATIONS = [
    {'id': 'G.2A',  'name': 'แม่น้ำกก บ้านกกโท้ง',   'lat': 19.921, 'lon': 99.849},
    {'id': 'G.7',   'name': 'แม่น้ำกก สะพานสบกก',     'lat': 20.228, 'lon': 99.882},
    {'id': 'Kh.89', 'name': 'แม่น้ำจัน บ้านหัวสะพาน', 'lat': 20.158, 'lon': 99.843},
    {'id': 'I.14',  'name': 'แม่น้ำอิง บ้านน้ำอิง',   'lat': 19.833, 'lon': 100.088},
]

ROUTE_ENDPOINTS = {
    'A': {'origin': (19.908, 99.832), 'dest': (20.434, 99.882), 'name': 'ทล.1 เมือง→แม่สาย',         'color': '#22c55e'},
    'B': {'origin': (19.908, 99.832), 'dest': (19.977, 100.074),'name': 'ทล.1020 เมือง→เทิง',        'color': '#f59e0b'},
    'C': {'origin': (19.908, 99.832), 'dest': (19.375, 99.858), 'name': 'ทล.118 เมือง→เวียงป่าเป้า', 'color': '#ef4444'},
}

RIVER_DANGER_RADIUS_M = 3000
FLOOD_PENALTY_MAX     = 9.0

ROAD_PENALTIES = {
    'motorway': 0.02, 'motorway_link': 0.03,
    'trunk': 0.05,    'trunk_link': 0.06,
    'primary': 0.10,  'primary_link': 0.12,
    'secondary': 0.20,'secondary_link': 0.22,
    'tertiary': 0.30, 'tertiary_link': 0.32,
    'residential': 0.42, 'unclassified': 0.50,
    'service': 0.55,  'track': 0.80, 'path': 0.95,
}

def haversine(lat1, lon1, lat2, lon2):
    R = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def river_proximity(lat, lon):
    d = min(haversine(lat, lon, s['lat'], s['lon']) for s in RIVER_STATIONS)
    return max(0.0, 1.0 - d / RIVER_DANGER_RADIUS_M)

def road_penalty(hw):
    if isinstance(hw, list): hw = hw[0]
    return ROAD_PENALTIES.get(str(hw), 0.40)

def fetch_live_signals():
    water_pressure, dam_pressure = 0.3, 0.5
    try:
        wl = requests.get(f'{FLOODNAV}/water-levels', timeout=6).json()
        ratios = [min(s['level']/s['warning_level'], 1.5) for s in wl if s.get('level') and s.get('warning_level')]
        if ratios: water_pressure = np.mean(ratios)
    except: pass
    try:
        dm = requests.get(f'{FLOODNAV}/dams', timeout=6).json()
        pcts = [min(d['percent']/100, 1.1) for d in dm if d.get('percent') is not None]
        if pcts: dam_pressure = np.mean(pcts)
    except: pass
    print(f'  water_pressure={water_pressure:.3f}  dam_pressure={dam_pressure:.3f}')
    return water_pressure, dam_pressure

def load_graph():
    if os.path.exists(GRAPH_CACHE):
        print(f'Loading graph from cache {GRAPH_CACHE}...')
        with open(GRAPH_CACHE, 'rb') as f:
            return pickle.load(f)
    print(f'Building graph from {OSM_FILE}...')
    ox.settings.log_console = False
    ox.settings.use_cache = False
    G = ox.graph_from_xml(OSM_FILE, retain_all=False, simplify=True)
    with open(GRAPH_CACHE, 'wb') as f:
        pickle.dump(G, f)
    print(f'  Cached: {G.number_of_nodes():,} nodes, {G.number_of_edges():,} edges')
    return G

def build_flood_weights(G, wp, dp):
    print(f'Computing flood weights ({G.number_of_edges():,} edges)...')
    for u, v, key, data in G.edges(keys=True, data=True):
        mid_lat = (G.nodes[u]['y'] + G.nodes[v]['y']) / 2
        mid_lon = (G.nodes[u]['x'] + G.nodes[v]['x']) / 2
        f_river = river_proximity(mid_lat, mid_lon)
        f_road  = road_penalty(data.get('highway', 'residential'))
        flood_risk = min(0.40*f_river + 0.25*min(wp,1.5) + 0.20*min(dp,1.1) + 0.15*f_road, 1.0)
        base = data.get('length', 50.0)
        G[u][v][key]['flood_risk'] = round(flood_risk, 4)
        G[u][v][key]['flood_cost'] = round(base * (1.0 + FLOOD_PENALTY_MAX * flood_risk), 2)
    risks = [d['flood_risk'] for _,_,d in G.edges(data=True)]
    print(f'  risk: min={min(risks):.3f} mean={np.mean(risks):.3f} p90={np.percentile(risks,90):.3f} max={max(risks):.3f}')

def flood_astar(G, origin_ll, dest_ll):
    orig = ox.nearest_nodes(G, origin_ll[1], origin_ll[0])
    dest = ox.nearest_nodes(G, dest_ll[1],   dest_ll[0])
    def h(u, v):
        return haversine(G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x'])
    return nx.astar_path(G, orig, dest, heuristic=h, weight='flood_cost')

def path_stats(G, path):
    pairs = list(zip(path[:-1], path[1:]))
    lengths = [G[u][v][0].get('length', 0.0)     for u,v in pairs]
    risks   = [G[u][v][0].get('flood_risk', 0.0) for u,v in pairs]
    return {
        'distance_km': round(sum(lengths)/1000, 2),
        'avg_risk':    round(float(np.mean(risks)), 3),
        'max_risk':    round(float(max(risks)), 3),
        'risk_pct':    round(float(np.mean(risks))*100, 1),
    }

# ── Main ─────────────────────────────────────────────────────────────────────
print('═'*55)
print('FloodNav — A* Flood-Aware Routing — เชียงราย')
print('═'*55)

print('\n[1] Fetching live signals from FloodNav API...')
wp, dp = fetch_live_signals()

print('\n[2] Loading road network...')
G = load_graph()

print('\n[3] Building flood-weighted graph...')
build_flood_weights(G, wp, dp)

print('\n[4] Running A* for each route...')
results = {}
for rid, ep in ROUTE_ENDPOINTS.items():
    print(f'\n  Route {rid} — {ep["name"]}')
    try:
        path = flood_astar(G, ep['origin'], ep['dest'])
        stats = path_stats(G, path)
        coords = [[G.nodes[n]['x'], G.nodes[n]['y']] for n in path]
        print(f'    {len(path)} nodes  {stats["distance_km"]} km  avg_risk={stats["avg_risk"]}  risk%={stats["risk_pct"]}')
        results[rid] = {'path': path, 'stats': stats, 'coords': coords, 'ep': ep}
    except Exception as e:
        print(f'    ERROR: {e}')

print('\n[5] Exporting flood_routes.geojson...')
features = []
for rid, r in results.items():
    features.append({
        'type': 'Feature',
        'geometry': {'type': 'LineString', 'coordinates': r['coords']},
        'properties': {
            'route_id':    rid,
            'name':        r['ep']['name'],
            'color':       r['ep']['color'],
            'distance_km': r['stats']['distance_km'],
            'avg_risk':    r['stats']['avg_risk'],
            'max_risk':    r['stats']['max_risk'],
            'risk_pct':    r['stats']['risk_pct'],
            'algorithm':   'NetworkX A* (flood-weighted OSM)',
            'nodes':       len(r['path']),
        }
    })

geojson = {'type': 'FeatureCollection', 'features': features}
with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(geojson, f, ensure_ascii=False, indent=2)

print(f'\n✓ Exported {OUTPUT}')
for feat in features:
    p = feat['properties']
    print(f'  Route {p["route_id"]}: {p["nodes"]} nodes  {p["distance_km"]} km  risk={p["risk_pct"]}%')
print('\nDone ✓')
