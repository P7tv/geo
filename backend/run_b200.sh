#!/bin/bash
echo "🚀 Setting up FloodNav AI Inference Server on B200 VM..."

# Install PyTorch with CUDA support first, then other dependencies
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt

# Run training to generate all ensemble models
if [ ! -f "models/xgb_flood_risk.json" ]; then
    echo "🧠 Training Ensemble Models (XGBoost, RF, LR, IsolationForest)..."
    python -c "import nbformat; from nbconvert.preprocessors import ExecutePreprocessor; nb = nbformat.read('train.ipynb', as_version=4); ep = ExecutePreprocessor(timeout=600, kernel_name='python3'); ep.preprocess(nb, {'metadata': {'path': './'}})"
    echo "✅ Models trained successfully."
fi

echo "⚡ Starting Uvicorn FastAPI Server on port 8087 with uvloop..."
uvicorn main:app --host 0.0.0.0 --port 8087 --loop uvloop
