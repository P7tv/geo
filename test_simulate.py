import requests

url = "http://127.0.0.1:8087/simulate"
payload = {
    "province": "เชียงราย",
    "rain_mm_per_day": 100,
    "duration_days": 3,
    "river_level": "critical",
    "road_blocks": [],
    "routes": [
        {
            "id": "A",
            "features": {
                "f_flood_exposure": 0.5,
                "f_forecast_rain": 0.2,
                "f_historical_freq": 0.8,
                "f_soil_moisture": 0.6
            }
        }
    ]
}

try:
    r = requests.post(url, json=payload)
    print("Status:", r.status_code)
    print("Response:", r.text)
except Exception as e:
    print("Error:", e)
