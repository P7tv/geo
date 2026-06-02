"""
FloodNav - Advanced FastAPI Inference Server (B200 VM Edition)
Features: Ensemble ML, Anomaly Detection, Resource Optimization, Forecast Timeline
Run with: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict
import numpy as np
import xgboost as xgb
import shap
import json
import os
import joblib
from scipy.optimize import linprog
import requests
import io
from PIL import Image
import cv2
from contextlib import asynccontextmanager
try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

# Global Models
xgb_model = None
rf_model = None
lr_model = None
iso_model = None
explainer = None
yolo_model = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global xgb_model, rf_model, lr_model, iso_model, explainer, yolo_model
    print("Loading Ensemble Models...")
    try:
        if YOLO is not None:
            print("Loading YOLOv8 Large model for B200 GPU...")
            yolo_model = YOLO("yolov8l.pt")
            try:
                yolo_model.to('cuda:0')
            except Exception as e:
                print(f"Could not pin to cuda:0, falling back: {e}")
        # 1. XGBoost
        xgb_model = xgb.Booster()
        xgb_model.load_model("models/xgb_flood_risk.json")
        # 2. Random Forest
        if os.path.exists("models/rf_model.pkl"):
            rf_model = joblib.load("models/rf_model.pkl")
        # 3. Logistic Regression
        if os.path.exists("models/lr_model.pkl"):
            lr_model = joblib.load("models/lr_model.pkl")
        # 4. Isolation Forest (Anomaly)
        if os.path.exists("models/iso_model.pkl"):
            iso_model = joblib.load("models/iso_model.pkl")
        
        X_dummy = np.random.rand(10, 4)
        explainer = shap.TreeExplainer(xgb_model, X_dummy, feature_perturbation="interventional")
        print("✅ Models Loaded successfully.")
    except Exception as e:
        print(f"Failed to load some models: {e}")
        
    yield
    # Teardown logic can go here if needed

app = FastAPI(
    title="FloodNav Advanced AI Inference", 
    version="2.0.0",
    lifespan=lifespan
)

class RouteFeatures(BaseModel):
    f_flood_exposure: float
    f_forecast_rain: float
    f_historical_freq: float
    f_soil_moisture: float

class ResourceOptRequest(BaseModel):
    total_vehicles: int
    routes: List[Dict] # e.g. [{"id": "A", "risk": 80, "distance": 10}, ...]

@app.post("/predict_risk")
async def predict_risk(features: RouteFeatures):
    """
    Predicts the risk percentage using an Ensemble (Voting Classifier).
    """
    x_input = np.array([[features.f_flood_exposure, features.f_forecast_rain, 
                         features.f_historical_freq, features.f_soil_moisture]])
    
    if xgb_model is not None:
        # XGBoost Prediction
        dmatrix = xgb.DMatrix(x_input, feature_names=["f_flood_exposure", "f_forecast_rain", "f_historical_freq", "f_soil_moisture"])
        xgb_pred = float(xgb_model.predict(dmatrix)[0])
        
        # Ensemble predictions if available
        preds = [xgb_pred]
        weights = [0.6] # XGBoost gets highest weight
        
        if rf_model is not None:
            rf_pred = rf_model.predict_proba(x_input)[0][1]
            preds.append(rf_pred)
            weights.append(0.3)
            
        if lr_model is not None:
            lr_pred = lr_model.predict_proba(x_input)[0][1]
            preds.append(lr_pred)
            weights.append(0.1)
            
        # Weighted Average Ensembling
        final_prob = np.average(preds, weights=weights)
        risk_score = final_prob * 100
        
        # SHAP explanations (using XGBoost as primary explainer)
        shap_values_raw = explainer.shap_values(x_input)[0]
        shap_values = shap_values_raw.tolist() if isinstance(shap_values_raw, np.ndarray) else shap_values_raw
        model_name = "Ensemble (XGB+RF+LR) B200 Optimized" if len(preds) > 1 else "XGBoost (B200 GPU)"
        
        details = {
            "xgb_prob": xgb_pred,
            "rf_prob": preds[1] if len(preds) > 1 else None,
            "lr_prob": preds[2] if len(preds) > 2 else None,
        }
    else:
        # Fallback
        base_risk = 10
        risk_score = base_risk + (features.f_flood_exposure * 40) + (features.f_forecast_rain * 30) + (features.f_historical_freq * 15) + (features.f_soil_moisture * 5)
        shap_values = [features.f_flood_exposure * 0.4, features.f_forecast_rain * 0.3, features.f_historical_freq * 0.15, features.f_soil_moisture * 0.05]
        model_name = "Rule-based Fallback"
        details = {}
    
    return {
        "status": "success",
        "risk_score": float(min(100.0, risk_score)),
        "model_used": model_name,
        "ensemble_details": details,
        "shap_explanation": {
            "f_flood_exposure": float(shap_values[0]),
            "f_forecast_rain": float(shap_values[1]),
            "f_historical_freq": float(shap_values[2]),
            "f_soil_moisture": float(shap_values[3])
        }
    }

@app.post("/detect_anomaly")
async def detect_anomaly(features: RouteFeatures):
    """
    Unsupervised learning to detect anomalous sensor readings (e.g. Flash Flood spike).
    """
    if iso_model is None:
        return {"status": "error", "message": "Isolation Forest model not loaded."}
        
    x_input = np.array([[features.f_flood_exposure, features.f_forecast_rain, 
                         features.f_historical_freq, features.f_soil_moisture]])
    
    # Returns 1 (normal) or -1 (anomaly)
    prediction = int(iso_model.predict(x_input)[0])
    
    # Decision function returns score (lower means more anomalous)
    score = float(iso_model.decision_function(x_input)[0])
    
    is_anomaly = (prediction == -1)
    
    return {
        "is_anomaly": is_anomaly,
        "anomaly_score": score,
        "alert": "⚠️ FLASH FLOOD ANOMALY DETECTED" if is_anomaly else "Normal pattern"
    }

@app.post("/forecast_risk")
async def forecast_risk(features: RouteFeatures):
    """
    Projects risk into the future (+6h, +12h, +24h) based on temporal decay and rain forecasts.
    """
    timeline = []
    current_rain = features.f_forecast_rain
    current_soil = features.f_soil_moisture
    
    for h in [6, 12, 24]:
        # Simple simulation: rain continues then tapers off, soil moisture increases then drains
        future_rain = current_rain * (1.0 - (h / 48.0)) 
        future_soil = min(1.0, current_soil + (future_rain * 0.15))
        
        future_features = RouteFeatures(
            f_flood_exposure=features.f_flood_exposure,
            f_forecast_rain=max(0, future_rain),
            f_historical_freq=features.f_historical_freq,
            f_soil_moisture=future_soil
        )
        # Call the existing predict function internally
        res = await predict_risk(future_features)
        timeline.append({
            "hour": f"+{h}h",
            "risk_score": res["risk_score"]
        })
        
    return {"timeline": timeline}

@app.post("/optimize_resources")
async def optimize_resources(req: ResourceOptRequest):
    """
    Linear Programming using scipy.optimize.linprog.
    Goal: Minimize total uncovered risk.
    Constraint 1: Sum of vehicles assigned <= total_vehicles
    Constraint 2: Max 3 vehicles per route
    """
    if not req.routes or req.total_vehicles <= 0:
        return {"error": "Invalid input"}
        
    n_routes = len(req.routes)
    
    # Objective: We want to assign vehicles to the highest risk routes.
    # linprog MINIMIZES c.T * x, so we use negative risk scores as coefficients.
    # The more risk a route has, the more negative the cost, so it assigns vehicles there.
    try:
        c = [-r.get("risk", 50) for r in req.routes]
    except Exception as e:
        return {"status": "error", "message": f"Invalid route format: {str(e)}"}
    
    # A_ub * x <= b_ub
    # Sum of all x_i <= total_vehicles
    A_ub = [np.ones(n_routes)]
    b_ub = [req.total_vehicles]
    
    # Bounds for each x_i: between 0 and 3 vehicles max per route
    bounds = [(0, 3) for _ in range(n_routes)]
    
    res = linprog(c, A_ub=A_ub, b_ub=b_ub, bounds=bounds, method='highs')
    
    if res.success:
        allocation = [int(round(x)) for x in res.x]
        result = []
        for i, r in enumerate(req.routes):
            result.append({
                "route_id": r["id"],
                "vehicles_assigned": allocation[i],
                "original_risk": r["risk"]
            })
        return {"status": "success", "allocation": result}
    else:
        return {"status": "failed", "message": "Optimization failed"}

@app.get("/health")
def health_check():
    return {"status": "ok", "models_loaded": {
        "xgboost": xgb_model is not None,
        "random_forest": rf_model is not None,
        "logistic_regression": lr_model is not None,
        "isolation_forest": iso_model is not None
    }}

@app.get("/metrics")
def get_metrics():
    try:
        with open("models/metrics.json", "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"error": "Metrics not found. Train model first."}

class CCTVRequest(BaseModel):
    image_url: str

def _load_image_from_url(url: str):
    """Load image from URL — supports both static images and MJPEG streams."""
    # Try OpenCV first (handles MJPEG streams + static images)
    cap = cv2.VideoCapture(url)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    ret, frame = cap.read()
    cap.release()
    if ret and frame is not None:
        return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

    # Fallback: requests.get for plain image URLs
    headers = {"User-Agent": "Mozilla/5.0"}
    res = requests.get(url, headers=headers, timeout=10)
    res.raise_for_status()
    return Image.open(io.BytesIO(res.content)).convert("RGB")

@app.post("/detect_cctv")
def detect_cctv(req: CCTVRequest):
    if yolo_model is None:
        return {"status": "error", "message": "YOLO model not loaded"}

    try:
        image = _load_image_from_url(req.image_url)
        
        results = yolo_model(image, verbose=False)
        
        detections = []
        v_count = 0
        p_count = 0
        
        vehicle_classes = [2, 3, 5, 7]
        person_classes = [0]
        
        for r in results:
            boxes = r.boxes
            for box in boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxyn[0].tolist()
                
                label = "unknown"
                if cls_id in vehicle_classes:
                    label = "vehicle"
                    v_count += 1
                elif cls_id in person_classes:
                    label = "person"
                    p_count += 1
                else:
                    continue
                    
                detections.append({
                    "class": label,
                    "confidence": conf,
                    "bbox": [x1, y1, x2, y2]
                })
                
        return {
            "status": "success",
            "counts": {"vehicles": v_count, "people": p_count},
            "detections": detections
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

def generate_frames(url: str):
    if yolo_model is None:
        yield (b'--frame\r\nContent-Type: text/plain\r\n\r\nYOLO model not loaded\r\n')
        return
        
    cap = cv2.VideoCapture(url)
    if not cap.isOpened():
        yield (b'--frame\r\nContent-Type: text/plain\r\n\r\nError opening video stream\r\n')
        return
        
    vehicle_classes = [2, 3, 5, 7]
    person_classes = [0]
    
    while True:
        success, frame = cap.read()
        if not success:
            break
            
        results = yolo_model(frame, stream=True, verbose=False)
        for r in results:
            boxes = r.boxes
            for box in boxes:
                cls_id = int(box.cls[0])
                if cls_id in vehicle_classes or cls_id in person_classes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
                    conf = float(box.conf[0])
                    
                    label = "Vehicle" if cls_id in vehicle_classes else "Person"
                    color = (0, 255, 0) if label == "Vehicle" else (0, 0, 255)
                    
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(frame, f"{label} {conf:.2f}", (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
        
        ret, buffer = cv2.imencode('.jpg', frame)
        if not ret:
            continue
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
               
    cap.release()

@app.get("/stream_cctv")
async def stream_cctv(url: str):
    return StreamingResponse(generate_frames(url), media_type='multipart/x-mixed-replace; boundary=frame')
