import requests
import json

JUPYTERHUB_URL = "http://swarm-manager.modelharbor.com:56751/user/scam"
TOKEN = "9583a8805b4946b7984944cbd40dc83e"
API_KEY = "floodnav-56f38b6dc2e659d0"

# Mock CCTV-CR01 (bus.jpg) as HIGH congestion on B200
mock_url = f"{JUPYTERHUB_URL}/proxy/8087/mock_cctv_congestion"
mock_headers = {
    "X-API-Key": API_KEY,
    "Authorization": f"token {TOKEN}",
    "Content-Type": "application/json"
}
mock_payload = {
    "camera_id": "https://raw.githubusercontent.com/ultralytics/yolov5/master/data/images/bus.jpg",
    "level": "high",
    "density": 15
}

print("1. Injecting mock high congestion for CCTV-CR01 on B200...")
try:
    r_mock = requests.post(mock_url, headers=mock_headers, json=mock_payload)
    print("Mock status:", r_mock.status_code)
    print("Mock response:", r_mock.json())
except Exception as e:
    print("Failed to mock congestion:", e)

# Now call Express server
express_url = "http://localhost:3001/api/dynamic-routes?province=เชียงราย"
express_payload = {
    "start": {"lat": 19.900, "lon": 99.825},
    "end": {"lat": 19.915, "lon": 99.840},
    "routeCount": 1
}

print("\n2. Querying Express /api/dynamic-routes...")
try:
    r = requests.post(express_url, json=express_payload, timeout=10)
    print("Status:", r.status_code)
    if r.status_code == 200:
        data = r.json()
        print("Success! Integrated Route details:")
        if 'routes' in data and len(data['routes']) > 0:
            route = data['routes'][0]
            print(f"  Distance: {route.get('distanceKm')} km")
            print(f"  Duration: {route.get('durationMin')} min")
            print(f"  Risk score: {route.get('risk')}")
            print(f"  Blocked/Penalized: {route.get('blocked')}")
        print("  Meta:")
        print(f"    Mode: {data.get('_meta', {}).get('mode')}")
        print(f"    Engine: {data.get('_meta', {}).get('routingEngine')}")
    else:
        print("Error:", r.text)
except Exception as e:
    print("Request failed:", e)
