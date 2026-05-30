"""
FloodNav Local Routing Service — port 3002   *** EXPERIMENTAL ***

IMPORTANT — RAM requirements:
  This service loads a 73 MB NetworkX graph (~450 MB RSS after load).
  Routing on a full-province subgraph requires an additional ~300–600 MB.
  Minimum recommended: 8 GB RAM with no other heavy processes running.
  On machines with < 8 GB free, use OSRM (default) instead.

Enable via:  ROUTING_ENGINE=local node server.js
             python3 scripts/routing_service.py

Safety limits enforced per request:
  • Subgraph bbox = start/end + 10 km buffer (no full-province copy)
  • routeCount capped at 2
  • blockedPoints capped at 5
  • Memory guard: aborts if process RSS > MEMORY_LIMIT_GB (default 5 GB)
"""

import math
import os
import pickle
import sys
import time
from pathlib import Path

import networkx as nx
import numpy as np
from flask import Flask, jsonify, request
from scipy.spatial import cKDTree

# ── Safety constants ───────────────────────────────────────────────────────────
MEMORY_LIMIT_GB   = float(os.environ.get('MEMORY_LIMIT_GB', '5.0'))
# Default 2 is safe on MacBook Air M3 8 GB RAM.
# Set MAX_ROUTE_COUNT=3 for 3 alternatives (higher CPU/RAM — test with free memory first).
MAX_ROUTE_COUNT   = int(os.environ.get('MAX_ROUTE_COUNT', '2'))
MAX_BLOCKED_PTS   = 5        # hard cap
BBOX_BUFFER_M     = 10_000   # 10 km buffer around start/end bbox
BLOCKED_PENALTY   = 999_999  # metres added to penalised edges (not removed)
PENALTY_FACTOR    = 8        # edge weight multiply on used paths
OVERLAP_THRESHOLD = 0.85     # node-overlap ratio → mark as similarRoute
SPEED_KMH         = 45       # assumed average speed for duration estimate

# ── Memory helper ──────────────────────────────────────────────────────────────

def _memory_usage_gb() -> float:
    """Current process RSS in GB. Uses psutil if available, else resource."""
    try:
        import psutil
        return psutil.Process().memory_info().rss / 1024 ** 3
    except ImportError:
        import resource
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS → bytes; Linux → kilobytes
        return rss / 1024 ** 3 if sys.platform == 'darwin' else rss / 1024 ** 2


def _check_memory() -> str | None:
    """Return error string if over limit, else None."""
    used = _memory_usage_gb()
    if used > MEMORY_LIMIT_GB:
        return (f'Memory limit exceeded: {used:.2f} GB used > '
                f'{MEMORY_LIMIT_GB} GB limit. '
                f'Set ROUTING_ENGINE=osrm (default) to avoid this.')
    return None

# ── Locate + load graph ────────────────────────────────────────────────────────
ROOT     = Path(__file__).parent.parent
PKL      = ROOT / 'chiang_rai_graph.pkl'
_startup = time.time()

print('[routing] *** EXPERIMENTAL — see module docstring for RAM requirements ***', flush=True)
_route_count_warning = '  ⚠️  MAX_ROUTE_COUNT=3 uses more CPU/RAM — ensure free memory before using' if MAX_ROUTE_COUNT >= 3 else ''
print(f'[routing] Memory limit: {MEMORY_LIMIT_GB} GB  |  max routes: {MAX_ROUTE_COUNT}  |  max blocked: {MAX_BLOCKED_PTS}{_route_count_warning}', flush=True)
print(f'[routing] Loading {PKL} …', flush=True)

G            = None
_graph_error = None
_load_time   = 0.0
_mem_after_load = 0.0
_node_list   = []
_node_coords = None
_kdtree      = None

try:
    t0 = time.time()
    with open(PKL, 'rb') as f:
        G = pickle.load(f)
    _load_time      = round(time.time() - t0, 2)
    _mem_after_load = _memory_usage_gb()
    print(f'[routing] Graph ready: {G.number_of_nodes():,} nodes  '
          f'{G.number_of_edges():,} edges  ({_load_time}s)  '
          f'RSS={_mem_after_load:.2f} GB', flush=True)
    _node_list   = list(G.nodes())
    _node_coords = np.array([[G.nodes[n]['x'], G.nodes[n]['y']] for n in _node_list])
    _kdtree      = cKDTree(_node_coords)
    print('[routing] KD-tree built — service ready', flush=True)
except (FileNotFoundError, OSError) as e:
    _graph_error = f'Graph file not found: {PKL} — {e}'
    print(f'[routing] ⚠️  {_graph_error}', flush=True)
except MemoryError as e:
    _graph_error = f'MemoryError loading graph — reduce MAX_ROUTE_COUNT or increase RAM: {e}'
    print(f'[routing] ⚠️  {_graph_error}', flush=True)
except Exception as e:
    _graph_error = f'Graph load failed: {type(e).__name__}: {e}'
    print(f'[routing] ⚠️  {_graph_error}', flush=True)

app = Flask(__name__)

# Always return JSON — never Flask HTML error pages
@app.errorhandler(Exception)
def _handle_exception(e):
    import traceback
    return jsonify({'error': str(e), 'detail': traceback.format_exc()[-500:]}), 500

@app.errorhandler(404)
def _handle_404(e):
    return jsonify({'error': 'Not found', 'path': request.path}), 404

@app.errorhandler(405)
def _handle_405(e):
    return jsonify({'error': 'Method not allowed'}), 405

# ── Geometry helpers ───────────────────────────────────────────────────────────

def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _nearest_node(lat: float, lon: float):
    _, idx = _kdtree.query([lon, lat])
    return _node_list[idx]


def _snap_dist(lat: float, lon: float, node) -> float:
    nd = G.nodes[node]
    return _haversine_m(lat, lon, nd['y'], nd['x'])


def _edge_geom(u, v) -> list:
    """[[lon, lat], ...] for min-length u→v edge (straight-line fallback)."""
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


def _path_to_geojson(path: list) -> list:
    coords: list = []
    for i in range(len(path) - 1):
        seg = _edge_geom(path[i], path[i + 1])
        if not coords:
            coords.extend(seg)
        elif abs(coords[-1][0] - seg[0][0]) < 1e-7 and abs(coords[-1][1] - seg[0][1]) < 1e-7:
            coords.extend(seg[1:])
        elif abs(coords[-1][0] - seg[-1][0]) < 1e-7 and abs(coords[-1][1] - seg[-1][1]) < 1e-7:
            coords.extend(list(reversed(seg))[1:])
        else:
            coords.extend(seg)
    return coords

# ── Subgraph extraction (RAM-safe) ─────────────────────────────────────────────

def _extract_subgraph(lat1: float, lon1: float,
                      lat2: float, lon2: float,
                      buffer_m: float = BBOX_BUFFER_M) -> nx.MultiDiGraph:
    """
    Return a SubGraph VIEW of G restricted to a bbox around (lat1,lon1)↔(lat2,lon2)
    plus buffer_m metres. This is a VIEW — no node/edge data is copied.
    """
    buf_deg = buffer_m / 111_000          # rough degrees (good enough for ≤20 km)
    min_lat = min(lat1, lat2) - buf_deg
    max_lat = max(lat1, lat2) + buf_deg
    min_lon = min(lon1, lon2) - buf_deg
    max_lon = max(lon1, lon2) + buf_deg
    nodes = [
        n for n, d in G.nodes(data=True)
        if min_lat <= d['y'] <= max_lat and min_lon <= d['x'] <= max_lon
    ]
    return G.subgraph(nodes)   # SubGraph view — O(1) extra memory for node list only

# ── Graph construction (operates on subgraph view) ─────────────────────────────

def _build_digraph(SG: nx.MultiDiGraph,
                   blocked_points: list) -> tuple[nx.DiGraph, int]:
    """
    Collapse MultiDiGraph subgraph → DiGraph with min-length edges.
    Edges whose midpoint falls within a blockedPoint radiusM receive
    +BLOCKED_PENALTY weight (penalised, NOT removed — routing remains possible
    if no alternative exists within the subgraph).

    Returns (DG, penalizedEdgeCount).
    """
    penalised: set = set()
    if blocked_points:
        for u, v, data in SG.edges(data=True):
            ud, vd = SG.nodes[u], SG.nodes[v]
            mid_lat = (ud['y'] + vd['y']) / 2
            mid_lon = (ud['x'] + vd['x']) / 2
            for bp in blocked_points:
                if _haversine_m(bp['lat'], bp['lon'], mid_lat, mid_lon) <= bp.get('radiusM', 500):
                    penalised.add((u, v))
                    break

    DG = nx.DiGraph()
    DG.add_nodes_from(SG.nodes(data=True))
    for u, v in SG.edges():
        if DG.has_edge(u, v):
            continue
        edges = SG.get_edge_data(u, v)
        best  = min(edges.values(), key=lambda e: e.get('length', float('inf')))
        base  = best.get('length', 50.0)
        w     = base + (BLOCKED_PENALTY if (u, v) in penalised else 0)
        DG.add_edge(u, v, weight=w, base_length=base,
                    penalized=((u, v) in penalised))

    return DG, len(penalised)

# ── Alternative routing ────────────────────────────────────────────────────────

def _node_overlap(path_a: list, path_b: list) -> float:
    set_a  = set(path_a)
    shared = sum(1 for n in path_b if n in set_a)
    return shared / len(path_b) if path_b else 0.0


def _find_routes(DG: nx.DiGraph, start, end,
                 count: int) -> tuple[list[dict], list[float]]:
    def heuristic(u, v):
        ud, vd = G.nodes[u], G.nodes[v]
        return _haversine_m(ud['y'], ud['x'], vd['y'], vd['x'])

    routes: list[dict] = []
    timings: list[float] = []
    penalty_DG = DG.copy()     # DiGraph (not MultiDiGraph) — much cheaper to copy

    for _ in range(count):
        t0 = time.time()
        try:
            path = nx.astar_path(penalty_DG, start, end,
                                 heuristic=heuristic, weight='weight')
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            break
        timings.append(round(time.time() - t0, 3))

        # True distance from original G (bypasses penalties)
        dist_m = sum(
            min(G.get_edge_data(path[j], path[j + 1]).values(),
                key=lambda e: e.get('length', float('inf'))).get('length', 0)
            for j in range(len(path) - 1)
            if G.get_edge_data(path[j], path[j + 1])
        )

        routes.append({
            'distance':  dist_m,
            'duration':  (dist_m / 1000) / SPEED_KMH * 3600,
            'geometry':  {'type': 'LineString',
                          'coordinates': _path_to_geojson(path)},
            'nodeCount': len(path),
            '_path':     path,
        })

        # Penalise used edges (×PENALTY_FACTOR) so next A* diverges
        for j in range(len(path) - 1):
            u, v = path[j], path[j + 1]
            if penalty_DG.has_edge(u, v):
                penalty_DG[u][v]['weight'] *= PENALTY_FACTOR

    return routes, timings


def _annotate_overlap(routes: list) -> list:
    if not routes:
        return routes
    ref = routes[0].get('_path', [])
    out = []
    for i, r in enumerate(routes):
        path = r.pop('_path', [])
        if i == 0:
            r['routeOverlapPct'] = 0
            r['similarRoute']    = False
        else:
            ov = _node_overlap(ref, path)
            r['routeOverlapPct'] = round(ov * 100, 1)
            r['similarRoute']    = ov > OVERLAP_THRESHOLD
        out.append(r)
    return out

# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get('/health')
def health():
    mem = _memory_usage_gb()
    return jsonify({
        'status':            'ok' if (G is not None and mem < MEMORY_LIMIT_GB) else ('graph-unavailable' if G is None else 'memory-warning'),
        'graphLoaded':       G is not None,
        'graphError':        _graph_error,
        'nodes':             G.number_of_nodes() if G is not None else 0,
        'edges':             G.number_of_edges() if G is not None else 0,
        'engine':            f'NetworkX A* + ×{PENALTY_FACTOR} edge-penalty alternates',
        'bboxBufferM':       BBOX_BUFFER_M,
        'blockedStrategy':   'penalizedEdges',
        'overlapThreshold':  OVERLAP_THRESHOLD,
        'memoryUsedGB':      round(mem, 2),
        'memoryLimitGB':     MEMORY_LIMIT_GB,
        'maxRouteCount':     MAX_ROUTE_COUNT,
        'maxRouteCountWarning': '3 routes uses more CPU/RAM — ensure free memory' if MAX_ROUTE_COUNT >= 3 else None,
        'maxBlockedPoints':  MAX_BLOCKED_PTS,
        'uptimeS':           round(time.time() - _startup, 1),
        'loadTimeS':         _load_time,
        'experimental':      True,
        'warning':           'Requires ≥8 GB free RAM. Set ROUTING_ENGINE=osrm for safe default.',
    })


@app.post('/route')
def route():
    # ── Graph availability guard — 503 triggers API fallback to OSRM ──────────
    if G is None:
        return jsonify({
            'error': _graph_error or 'Graph not loaded',
            'graphLoaded': False,
            'hint': 'API will fallback to OSRM automatically',
        }), 503

    # ── Memory guard (before doing any work) ──────────────────────────────────
    mem_err = _check_memory()
    if mem_err:
        return jsonify({'error': mem_err, 'memoryLimitGB': MEMORY_LIMIT_GB}), 503

    body    = request.get_json(force=True) or {}
    start   = body.get('start')
    end     = body.get('end')
    blocked = (body.get('blockedPoints') or [])[:MAX_BLOCKED_PTS]
    count   = min(int(body.get('routeCount', 2)), MAX_ROUTE_COUNT)

    if not start or not end:
        return jsonify({'error': 'start and end required'}), 400

    timing: dict = {}
    t_total = time.time()

    # 1. Snap to nearest node (KD-tree, O(log n))
    t0  = time.time()
    sn  = _nearest_node(start['lat'], start['lon'])
    en  = _nearest_node(end['lat'],   end['lon'])
    snap_s = _snap_dist(start['lat'], start['lon'], sn)
    snap_e = _snap_dist(end['lat'],   end['lon'],   en)
    timing['snapS'] = round(time.time() - t0, 4)

    if sn == en:
        return jsonify({'error': 'Start and end snap to same node — points too close'}), 400

    # 2. Extract subgraph bbox (SubGraph VIEW — no copy)
    t0  = time.time()
    SG  = _extract_subgraph(start['lat'], start['lon'],
                             end['lat'],   end['lon'])
    timing['subgraphNodes'] = SG.number_of_nodes()
    timing['subgraphEdges'] = SG.number_of_edges()
    timing['subgraphS']     = round(time.time() - t0, 4)

    # Verify start/end nodes are inside subgraph
    if sn not in SG.nodes or en not in SG.nodes:
        return jsonify({
            'error':   'Start or end node falls outside subgraph bbox — increase BBOX_BUFFER_M',
            'timing':  timing,
        }), 400

    # Memory guard after subgraph construction
    mem_err = _check_memory()
    if mem_err:
        return jsonify({'error': mem_err, 'memoryLimitGB': MEMORY_LIMIT_GB}), 503

    # 3. Build penalised DiGraph from subgraph
    t0 = time.time()
    DG, penalized_count = _build_digraph(SG, blocked)
    timing['buildGraphS'] = round(time.time() - t0, 3)

    # 4. Find alternative routes
    routes_raw, astar_times = _find_routes(DG, sn, en, count)
    timing['astarS']  = astar_times
    timing['totalS']  = round(time.time() - t_total, 3)

    if not routes_raw:
        return jsonify({
            'error':   'No path found in subgraph — start/end may be disconnected within bbox',
            'timing':  timing,
            'hint':    'Try increasing BBOX_BUFFER_M or check that start/end are on drivable roads',
        }), 404

    # 5. Annotate overlap, strip internal _path
    routes = _annotate_overlap(routes_raw)

    mem_after = _memory_usage_gb()
    print(f'[routing] {len(routes)} routes | '
          f'subgraph={timing["subgraphNodes"]}n/{timing["subgraphEdges"]}e | '
          f'snap={timing["snapS"]}s build={timing["buildGraphS"]}s '
          f'astar={astar_times} total={timing["totalS"]}s | '
          f'penalizedEdges={penalized_count} | '
          f'RAM={mem_after:.2f}GB', flush=True)

    return jsonify({
        'routes':          routes,
        'timing':          timing,
        'snap':            {'startM': round(snap_s), 'endM': round(snap_e)},
        'penalizedEdges':  penalized_count,
        'blockedStrategy': 'penalizedEdges',
        'subgraphSize':    {'nodes': timing['subgraphNodes'],
                            'edges': timing['subgraphEdges']},
        'memoryUsedGB':    round(mem_after, 2),
        'experimental':    True,
    })


if __name__ == '__main__':
    # Railway injects PORT; local dev falls back to 3002
    port = int(os.environ.get('PORT', os.environ.get('ROUTING_PORT', 3002)))
    print(f'[routing] Listening on :{port}', flush=True)
    app.run(host='0.0.0.0', port=port, threaded=True)
