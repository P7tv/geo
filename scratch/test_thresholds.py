import cv2
from ultralytics import YOLO

model = YOLO("backend/yolov8n.pt")
url = "https://camera1.iticfoundation.org/mjpeg2.php?camid=10.8.0.14:8001"
print(f"Downloading frame from {url}...")
cap = cv2.VideoCapture(url)
ret, frame = cap.read()
cap.release()

if not ret or frame is None:
    print("❌ Failed to download frame")
    exit(1)

print(f"Frame shape: {frame.shape}")
for thresh in [0.25, 0.20, 0.15, 0.12, 0.10]:
    print(f"\n--- Testing with conf={thresh} ---")
    results = model(frame, conf=thresh, verbose=False)
    detected = False
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            label = model.names[cls_id]
            print(f"  - {label} (Conf: {conf:.4f}) at {box.xyxy[0].tolist()}")
            detected = True
    if not detected:
        print("  (No objects detected)")
