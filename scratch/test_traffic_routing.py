import requests
import json

# Target the B200 FastAPI server directly
JUPYTERHUB_URL = "http://swarm-manager.modelharbor.com:56751/user/scam"
TOKEN = "9583a8805b4946b7984944cbd40dc83e"
API_KEY = "floodnav-56f38b6dc2e659d0"

url = f"{JUPYTERHUB_URL}/proxy/8087/route"
headers = {
    "X-API-Key": API_KEY,
    "Authorization": f"token {TOKEN}",
    "Content-Type": "application/json"
}

# Coordinate near CCTV-CR01 (19.908, 99.832)
# Start and end that naturally cross this point
payload_without_traffic = {
    "start": {"lat": 19.900, "lon": 99.825},
    "end": {"lat": 19.915, "lon": 99.840},
    "province": "เชียงราย",
    "routeCount": 1
}

payload_with_traffic = {
    "start": {"lat": 19.900, "lon": 99.825},
    "end": {"lat": 19.915, "lon": 99.840},
    "province": "เชียงราย",
    "routeCount": 1,
    "trafficPoints": [
        {
            "lat": 19.908,
            "lon": 99.832,
            "radiusM": 300,
            "severity": 1.0
        }
    ]
}

print("=== 1. Routing without traffic ===")
try:
    r1 = requests.post(url, headers=headers, json=payload_without_traffic)
    print("Status:", r1.status_code)
    if r1.status_code == 200:
        data = r1.json()
        print("Success! Route details:")
        print(f"  Distance: {data['routes'][0]['distance']:.1f} m")
        print(f"  Duration: {data['routes'][0]['duration']:.1f} s")
        print(f"  Penalized Edges: {data.get('penalizedEdges', 0)}")
        print(f"  Traffic Weighted Edges: {data.get('trafficWeightedEdges', 0)}")
    else:
        print("Error:", r1.text)
except Exception as e:
    print("Request failed:", e)

print("\n=== 2. Routing WITH traffic ===")
try:
    r2 = requests.post(url, headers=headers, json=payload_with_traffic)
    print("Status:", r2.status_code)
    if r2.status_code == 200:
        data = r2.json()
        print("Success! Route details:")
        print(f"  Distance: {data['routes'][0]['distance']:.1f} m")
        print(f"  Duration: {data['routes'][0]['duration']:.1f} s")
        print(f"  Penalized Edges: {data.get('penalizedEdges', 0)}")
        print(f"  Traffic Weighted Edges: {data.get('trafficWeightedEdges', 0)}")
    else:
        print("Error:", r2.text)
except Exception as e:
    print("Request failed:", e)
