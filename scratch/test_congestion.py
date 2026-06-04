import cv2
import requests
import json
import time

JUPYTERHUB_URL = "http://swarm-manager.modelharbor.com:56751/user/scam"
TOKEN = "9583a8805b4946b7984944cbd40dc83e"
API_KEY = "floodnav-56f38b6dc2e659d0"
CAMERA_ID = "https://camera1.iticfoundation.org/mjpeg2.php?camid=10.8.0.14:8001"

def test_congestion_telemetry():
    print("1. Opening CCTV stream...")
    cap = cv2.VideoCapture(CAMERA_ID)
    if not cap.isOpened():
        print("❌ Failed to open camera stream!")
        return

    # Warm up and read 10 frames
    print("2. Reading and sending 10 frames sequentially to process_frame...")
    headers = {
        "X-API-Key": API_KEY,
        "Authorization": f"token {TOKEN}",
        "Content-Type": "image/jpeg"
    }
    
    for i in range(1, 11):
        ret, frame = cap.read()
        if not ret or frame is None:
            print(f"❌ Frame {i} read failed")
            continue
            
        # Encode frame to JPEG
        _, buffer = cv2.imencode(".jpg", frame)
        img_bytes = buffer.tobytes()
        
        t0 = time.time()
        res = requests.post(
            f"{JUPYTERHUB_URL}/proxy/8087/process_frame?camera_id={requests.utils.quote(CAMERA_ID)}",
            headers=headers,
            data=img_bytes,
            timeout=10
        )
        elapsed = time.time() - t0
        print(f"Frame {i}: process_frame HTTP {res.status_code} ({elapsed:.2f}s)")
        time.sleep(0.1) # Simulate real-time delay
        
    cap.release()

    print("\n3. Querying /all_cctv_congestion to see calculated traffic status...")
    res = requests.get(
        f"{JUPYTERHUB_URL}/proxy/8087/all_cctv_congestion",
        headers={
            "X-API-Key": API_KEY,
            "Authorization": f"token {TOKEN}"
        }
    )
    
    if res.status_code == 200:
        print("Response JSON:")
        print(json.dumps(res.json(), indent=2, ensure_ascii=False))
    else:
        print(f"❌ Failed to fetch congestion status: {res.status_code} - {res.text}")

if __name__ == "__main__":
    test_congestion_telemetry()
