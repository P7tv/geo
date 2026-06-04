import cv2
import time
from ultralytics import YOLO

def run_test():
    model = YOLO("yolo26n.pt")
    cap = cv2.VideoCapture("https://camera1.iticfoundation.org/mjpeg2.php?camid=10.8.0.14:8001")
    
    print("Reading 5 frames and running track...")
    for i in range(5):
        ret, frame = cap.read()
        if not ret or frame is None:
            print(f"Frame {i} read failed")
            continue
            
        results = model.track(frame, persist=True, conf=0.15, verbose=False)
        boxes = results[0].boxes
        has_id = hasattr(boxes, "id") and boxes.id is not None
        if has_id:
            ids = boxes.id.int().cpu().tolist()
            print(f"Frame {i}: Detected {len(boxes)} objects. Track IDs: {ids}")
        else:
            print(f"Frame {i}: Detected {len(boxes)} objects. No Track IDs assigned.")
            
    cap.release()

if __name__ == "__main__":
    run_test()
