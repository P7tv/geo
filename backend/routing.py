import math
import os
import pickle
import sys
import time
from pathlib import Path

import networkx as nx
import numpy as np
import osmnx as ox
from fastapi import APIRouter, Request, BackgroundTasks
from fastapi.responses import JSONResponse
from scipy.spatial import cKDTree

router = APIRouter()

MEMORY_LIMIT_GB   = float(os.environ.get('MEMORY_LIMIT_GB', '5.0'))
MAX_ROUTE_COUNT   = int(os.environ.get('MAX_ROUTE_COUNT', '2'))
MAX_BLOCKED_PTS   = 5
MAX_FLOOD_PTS     = 50
BBOX_BUFFER_M     = 10_000
BLOCKED_PENALTY   = 999_999
FLOOD_PENALTY_MAX = 40_000
PENALTY_FACTOR    = 8
OVERLAP_THRESHOLD = 0.85
SPEED_KMH         = 45
ROOT = Path(__file__).parent.parent

# Province to OSM Place mapping
PROVINCE_EN_MAP = {
    'เชียงราย': 'Chiang Rai Province, Thailand',
    'เชียงใหม่': 'Chiang Mai Province, Thailand',
    'น่าน': 'Nan Province, Thailand',
    'พะเยา': 'Phayao Province, Thailand',
    'แพร่': 'Phrae Province, Thailand',
    'นครสวรรค์': 'Nakhon Sawan Province, Thailand',
    'กรุงเทพมหานคร': 'Bangkok, Thailand',  # Bangkok is a special administrative area, usually 'Bangkok, Thailand' works for the whole province
    'ขอนแก่น': 'Khon Kaen Province, Thailand',
    'อุบลราชธานี': 'Ubon Ratchathani Province, Thailand',
    'สุราษฎร์ธานี': 'Surat Thani Province, Thailand',
    'ภูเก็ต': 'Phuket Province, Thailand',
    'สงขลา': 'Songkhla Province, Thailand',
}

# Global state for multi-graph
graphs = {}
_loading_status = {}

def _memory_usage_gb() -> float:
    try:
        import psutil
        return psutil.Process().memory_info().rss / 1024 ** 3
    except ImportError:
        import resource
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return rss / 1024 ** 3 if sys.platform == 'darwin' else rss / 1024 ** 2

def _check_memory() -> str | None:
    used = _memory_usage_gb()
    if used > MEMORY_LIMIT_GB:
        return f'Memory limit exceeded: {used:.2f} GB used > {MEMORY_LIMIT_GB} GB limit.'
    return None

def get_pkl_path(province_name: str) -> Path:
    en_name = PROVINCE_EN_MAP.get(province_name, f"{province_name}, Thailand")
    filename = en_name.split(',')[0].strip().lower().replace(' ', '_') + '_graph.pkl'
    return ROOT / filename

def load_graph_sync(province_name: str):
    if province_name in graphs: return True
    
    pkl_path = get_pkl_path(province_name)
    if not pkl_path.exists():
        _loading_status[province_name] = True
        try:
            place_name = PROVINCE_EN_MAP.get(province_name, f"{province_name}, Thailand")
            print(f"[routing] 📥 Auto-downloading OSM network for {place_name}...")
            # optimize speed with simplify=True and retain_all=False
            G = ox.graph_from_place(place_name, network_type="drive", simplify=True)
            with open(pkl_path, 'wb') as f:
                pickle.dump(G, f)
            print(f"[routing] ✅ Saved {pkl_path} successfully!")
        except Exception as e:
            print(f"[routing] ❌ Error downloading graph for {province_name}: {e}")
            _loading_status[province_name] = False
            return False
            
    try:
        print(f"[routing] Loading {pkl_path} into memory...")
        with open(pkl_path, 'rb') as f:
            G = pickle.load(f)
        node_list = list(G.nodes())
        node_coords = np.array([[G.nodes[n]['x'], G.nodes[n]['y']] for n in node_list])
        kdtree = cKDTree(node_coords)
        graphs[province_name] = {
            'G': G,
            'node_list': node_list,
            'kdtree': kdtree
        }
        print(f"[routing] ✅ Graph for {province_name} ready! ({G.number_of_nodes()} nodes)")
        _loading_status[province_name] = False
        return True
    except Exception as e:
        print(f"[routing] ❌ Failed to load {pkl_path}: {e}")
        _loading_status[province_name] = False
        return False

def preload_all_graphs():
    print("="*50)
    print("🌍 Starting background preload of ALL supported provinces...")
    print("="*50)
    for province in PROVINCE_EN_MAP.keys():
        print(f"[preload] ⏳ Processing {province}...")
        load_graph_sync(province)
    print("="*50)
    print("✅ All provinces have been preloaded successfully!")
    print("="*50)

# Geometry helpers (modified to take context G, kdtree, etc)
def _haversine_m(lat1, lon1, lat2, lon2):
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def _nearest_node(lat, lon, kdtree, node_list):
    _, idx = kdtree.query([lon, lat])
    return node_list[idx]

def _snap_dist(lat, lon, node, G):
    nd = G.nodes[node]
    return _haversine_m(lat, lon, nd['y'], nd['x'])

def _edge_geom(u, v, G):
    edges = G.get_edge_data(u, v) or G.get_edge_data(v, u)
    if not edges:
        ud, vd = G.nodes[u], G.nodes[v]
        return [[ud['x'], ud['y']], [vd['x'], vd['y']]]
    best = min(edges.values(), key=lambda e: e.get('length', float('inf')))
    geom = best.get('geometry')
    if geom is not None:
        try:
            return [[c[0], c[1]] for c in geom.coords]
        except Exception:
            pass
    ud, vd = G.nodes[u], G.nodes[v]
    return [[ud['x'], ud['y']], [vd['x'], vd['y']]]

def _path_to_geojson(path, G):
    coords = []
    for i in range(len(path) - 1):
        seg = _edge_geom(path[i], path[i + 1], G)
        if not coords:
            coords.extend(seg)
        elif abs(coords[-1][0] - seg[0][0]) < 1e-7 and abs(coords[-1][1] - seg[0][1]) < 1e-7:
            coords.extend(seg[1:])
        elif abs(coords[-1][0] - seg[-1][0]) < 1e-7 and abs(coords[-1][1] - seg[-1][1]) < 1e-7:
            coords.extend(list(reversed(seg))[1:])
        else:
            coords.extend(seg)
    return coords

def _extract_subgraph(lat1, lon1, lat2, lon2, G, buffer_m=BBOX_BUFFER_M):
    buf_deg = buffer_m / 111_000
    min_lat = min(lat1, lat2) - buf_deg
    max_lat = max(lat1, lat2) + buf_deg
    min_lon = min(lon1, lon2) - buf_deg
    max_lon = max(lon1, lon2) + buf_deg
    nodes = [n for n, d in G.nodes(data=True) if min_lat <= d['y'] <= max_lat and min_lon <= d['x'] <= max_lon]
    return G.subgraph(nodes)

def _build_digraph(SG, blocked_points, flood_points=None):
    penalised = set()
    flood_w = {}
    if blocked_points:
        for u, v, _ in SG.edges(data=True):
            ud, vd = SG.nodes[u], SG.nodes[v]
            mid_lat = (ud['y'] + vd['y']) / 2
            mid_lon = (ud['x'] + vd['x']) / 2
            for bp in blocked_points:
                if _haversine_m(bp['lat'], bp['lon'], mid_lat, mid_lon) <= bp.get('radiusM', 500):
                    penalised.add((u, v))
                    break
    if flood_points:
        for u, v, _ in SG.edges(data=True):
            if (u, v) in penalised: continue
            ud, vd = SG.nodes[u], SG.nodes[v]
            mid_lat = (ud['y'] + vd['y']) / 2
            mid_lon = (ud['x'] + vd['x']) / 2
            max_sev = 0.0
            for fp in flood_points:
                if _haversine_m(fp['lat'], fp['lon'], mid_lat, mid_lon) <= fp.get('radiusM', 300):
                    max_sev = max(max_sev, fp.get('severity', 0.5))
            if max_sev > 0:
                flood_w[(u, v)] = FLOOD_PENALTY_MAX * max_sev

    DG = nx.DiGraph()
    DG.add_nodes_from(SG.nodes(data=True))
    for u, v in SG.edges():
        if DG.has_edge(u, v): continue
        edges = SG.get_edge_data(u, v)
        best = min(edges.values(), key=lambda e: e.get('length', float('inf')))
        base = best.get('length', 50.0)
        w = base
        if (u, v) in penalised: w += BLOCKED_PENALTY
        elif (u, v) in flood_w: w += flood_w[(u, v)]
        DG.add_edge(u, v, weight=w, base_length=base, penalized=((u, v) in penalised), flood_weighted=((u, v) in flood_w))
    return DG, len(penalised), len(flood_w)

def _node_overlap(path_a, path_b):
    set_a = set(path_a)
    shared = sum(1 for n in path_b if n in set_a)
    return shared / len(path_b) if path_b else 0.0

def _find_routes(DG, start, end, count, G):
    def heuristic(u, v):
        ud, vd = G.nodes[u], G.nodes[v]
        return _haversine_m(ud['y'], ud['x'], vd['y'], vd['x'])
    routes = []
    timings = []
    penalty_DG = DG.copy()
    for _ in range(count):
        t0 = time.time()
        try:
            path = nx.astar_path(penalty_DG, start, end, heuristic=heuristic, weight='weight')
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            break
        timings.append(round(time.time() - t0, 3))
        dist_m = sum(min(G.get_edge_data(path[j], path[j+1]).values(), key=lambda e: e.get('length', float('inf'))).get('length', 0) for j in range(len(path)-1) if G.get_edge_data(path[j], path[j+1]))
        routes.append({'distance': dist_m, 'duration': (dist_m/1000)/SPEED_KMH*3600, 'geometry': {'type': 'LineString', 'coordinates': _path_to_geojson(path, G)}, 'nodeCount': len(path), '_path': path})
        for j in range(len(path)-1):
            u, v = path[j], path[j+1]
            if penalty_DG.has_edge(u, v): penalty_DG[u][v]['weight'] *= PENALTY_FACTOR
    return routes, timings

def _annotate_overlap(routes):
    if not routes: return routes
    ref = routes[0].get('_path', [])
    out = []
    for i, r in enumerate(routes):
        path = r.pop('_path', [])
        if i == 0:
            r['routeOverlapPct'] = 0
            r['similarRoute'] = False
        else:
            ov = _node_overlap(ref, path)
            r['routeOverlapPct'] = round(ov * 100, 1)
            r['similarRoute'] = ov > OVERLAP_THRESHOLD
        out.append(r)
    return out

@router.get('/route/health')
def health():
    return {
        'status': 'ok',
        'loaded_graphs': list(graphs.keys()),
        'memoryUsedGB': round(_memory_usage_gb(), 2),
    }

@router.post('/route')
async def route(request: Request, background_tasks: BackgroundTasks):
    mem_err = _check_memory()
    if mem_err:
        return JSONResponse({'error': mem_err}, status_code=503)

    body = await request.json()
    start = body.get('start')
    end = body.get('end')
    province = body.get('province', 'เชียงราย')
    blocked = (body.get('blockedPoints') or [])[:MAX_BLOCKED_PTS]
    flood_pts = (body.get('floodPoints') or [])[:MAX_FLOOD_PTS]
    count = min(int(body.get('routeCount', 2)), MAX_ROUTE_COUNT)

    if not start or not end:
        return JSONResponse({'error': 'start and end required'}, status_code=400)

    # Multi-Graph Lazy Loading
    if province not in graphs:
        if _loading_status.get(province):
            return JSONResponse({
                'error': f'Graph for {province} is currently downloading/loading. Please wait...',
                'graphLoaded': False
            }, status_code=503)
            
        # Spawn background task to load it so frontend doesn't timeout!
        background_tasks.add_task(load_graph_sync, province)
        return JSONResponse({
            'error': f'Graph for {province} not loaded. Triggered background generation.',
            'graphLoaded': False,
            'hint': 'Will use OSRM fallback for now.'
        }, status_code=503)

    # Proceed with routing since graph is ready
    g_data = graphs[province]
    G = g_data['G']
    node_list = g_data['node_list']
    kdtree = g_data['kdtree']

    timing = {}
    t_total = time.time()

    t0 = time.time()
    sn = _nearest_node(start['lat'], start['lon'], kdtree, node_list)
    en = _nearest_node(end['lat'], end['lon'], kdtree, node_list)
    snap_s = _snap_dist(start['lat'], start['lon'], sn, G)
    snap_e = _snap_dist(end['lat'], end['lon'], en, G)
    timing['snapS'] = round(time.time() - t0, 4)

    if sn == en:
        return JSONResponse({'error': 'Start and end snap to same node'}, status_code=400)

    t0 = time.time()
    SG = _extract_subgraph(start['lat'], start['lon'], end['lat'], end['lon'], G)
    timing['subgraphNodes'] = SG.number_of_nodes()
    timing['subgraphEdges'] = SG.number_of_edges()
    timing['subgraphS'] = round(time.time() - t0, 4)

    if sn not in SG.nodes or en not in SG.nodes:
        return JSONResponse({'error': 'Start/end falls outside subgraph bbox', 'timing': timing}, status_code=400)

    t0 = time.time()
    DG, penalized_count, flood_weighted_count = _build_digraph(SG, blocked, flood_pts or None)
    timing['buildGraphS'] = round(time.time() - t0, 3)

    routes_raw, astar_times = _find_routes(DG, sn, en, count, G)
    timing['astarS'] = astar_times
    timing['totalS'] = round(time.time() - t_total, 3)

    if not routes_raw:
        return JSONResponse({'error': 'No path found in subgraph', 'timing': timing}, status_code=404)

    routes = _annotate_overlap(routes_raw)
    mem_after = _memory_usage_gb()

    return {
        'routes': routes,
        'timing': timing,
        'snap': {'startM': round(snap_s), 'endM': round(snap_e)},
        'penalizedEdges': penalized_count,
        'subgraphSize': {'nodes': timing['subgraphNodes'], 'edges': timing['subgraphEdges']},
        'memoryUsedGB': round(mem_after, 2)
    }
