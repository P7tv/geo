import requests
import json
import cv2
import time
from ultralytics import YOLO

local_model = YOLO("backend/yolov8n.pt")

JUPYTERHUB_URL = "http://swarm-manager.modelharbor.com:56751/user/scam"
TOKEN = "9583a8805b4946b7984944cbd40dc83e"
API_KEY = "floodnav-56f38b6dc2e659d0"
camera_url = "https://camera1.iticfoundation.org/mjpeg2.php?camid=10.8.0.14:8001"

print("Waiting for a vehicle to appear in the camera feed (max 30 attempts)...")
for attempt in range(1, 31):
    cap = cv2.VideoCapture(camera_url)
    ret, frame = cap.read()
    cap.release()
    
    if not ret or frame is None:
        print(f"[{attempt}] Failed to download frame.")
        time.sleep(1.0)
        continue
        
    results = local_model(frame, conf=0.15, verbose=False)
    has_vehicle = False
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            if cls_id in [2, 3, 5, 7]: # vehicle
                has_vehicle = True
                break
                
    if has_vehicle:
        print(f"🎉 Vehicle detected on attempt {attempt}!")
        # Run comparison
        ret, buffer = cv2.imencode(".jpg", frame)
        img_bytes = buffer.tobytes()
        
        # Remote B200 call
        url = f"{JUPYTERHUB_URL}/proxy/8087/detect_cctv_bytes"
        headers = {
            "X-API-Key": API_KEY,
            "Authorization": f"token {TOKEN}",
            "Content-Type": "image/jpeg"
        }
        try:
            res = requests.post(url, headers=headers, data=img_bytes, timeout=10)
            print("Remote Status Code:", res.status_code)
            print("Remote Detections JSON:")
            print(json.dumps(res.json(), indent=2, ensure_ascii=False))
        except Exception as e:
            print("❌ Remote request failed:", e)
        break
    else:
        print(f"[{attempt}] No vehicles found, retrying...")
        time.sleep(1.0)
else:
    print("Reached maximum attempts without detecting a vehicle.")
