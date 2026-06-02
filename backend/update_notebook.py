import json

with open("backend/train.ipynb", "r") as f:
    nb = json.load(f)

# Update imports
for cell in nb["cells"]:
    if cell["cell_type"] == "code" and "import xgboost as xgb" in "".join(cell["source"]):
        cell["source"] = [
            "import numpy as np\n",
            "import pandas as pd\n",
            "import json\n",
            "import os\n",
            "import requests\n",
            "import xgboost as xgb\n",
            "from sklearn.ensemble import RandomForestClassifier, IsolationForest\n",
            "from sklearn.linear_model import LogisticRegression\n",
            "import joblib\n",
            "from sklearn.model_selection import train_test_split\n",
            "from sklearn.metrics import accuracy_score, f1_score, roc_auc_score\n",
            "import shap\n",
            "import matplotlib.pyplot as plt\n"
        ]
        break

# Find the training cell
train_idx = -1
for i, cell in enumerate(nb["cells"]):
    if cell["cell_type"] == "code" and "model = xgb.XGBClassifier(" in "".join(cell["source"]):
        train_idx = i
        break

new_training_source = [
    "features = ['f_flood_exposure', 'f_forecast_rain', 'f_historical_freq', 'f_soil_moisture']\n",
    "X = df[features]\n",
    "y = df['is_dangerous']\n",
    "\n",
    "X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)\n",
    "\n",
    "print(\"Training XGBoost on B200 GPU...\")\n",
    "xgb_model = xgb.XGBClassifier(objective='binary:logistic', tree_method='hist', device='cuda', learning_rate=0.05, max_depth=6, n_estimators=300)\n",
    "xgb_model.fit(X_train, y_train)\n",
    "\n",
    "print(\"Training Random Forest...\")\n",
    "rf_model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)\n",
    "rf_model.fit(X_train, y_train)\n",
    "\n",
    "print(\"Training Logistic Regression...\")\n",
    "lr_model = LogisticRegression()\n",
    "lr_model.fit(X_train, y_train)\n",
    "\n",
    "print(\"Training Isolation Forest (Anomaly Detection)...\")\n",
    "iso_model = IsolationForest(contamination=0.05, random_state=42)\n",
    "iso_model.fit(X_train)\n",
    "\n",
    "# Evaluate Ensemble (Voting by Average)\n",
    "preds_xgb = xgb_model.predict_proba(X_test)[:, 1]\n",
    "preds_rf = rf_model.predict_proba(X_test)[:, 1]\n",
    "preds_lr = lr_model.predict_proba(X_test)[:, 1]\n",
    "ensemble_probs = (preds_xgb + preds_rf + preds_lr) / 3.0\n",
    "ensemble_preds = (ensemble_probs >= 0.5).astype(int)\n",
    "\n",
    "acc = accuracy_score(y_test, ensemble_preds)\n",
    "f1 = f1_score(y_test, ensemble_preds)\n",
    "auc = roc_auc_score(y_test, ensemble_probs)\n",
    "print(f\"Ensemble Accuracy: {acc:.4f} | F1: {f1:.4f} | AUC: {auc:.4f}\")\n"
]

nb["cells"][train_idx]["source"] = new_training_source

# Update export cell
export_idx = -1
for i, cell in enumerate(nb["cells"]):
    if cell["cell_type"] == "code" and "model.save_model(" in "".join(cell["source"]):
        export_idx = i
        break

new_export_source = [
    "os.makedirs(\"models\", exist_ok=True)\n",
    "\n",
    "# Save Metrics\n",
    "metrics = {\n",
    "    \"model\": \"Ensemble_B200_Voting\",\n",
    "    \"accuracy\": float(acc),\n",
    "    \"f1_score\": float(f1),\n",
    "    \"auc\": float(auc),\n",
    "    \"features\": features\n",
    "}\n",
    "with open(\"models/metrics.json\", \"w\") as f:\n",
    "    json.dump(metrics, f, indent=2)\n",
    "print(\"Saved metrics.json\")\n",
    "\n",
    "# Save Models\n",
    "xgb_model.save_model(\"models/xgb_flood_risk.json\")\n",
    "joblib.dump(rf_model, \"models/rf_model.pkl\")\n",
    "joblib.dump(lr_model, \"models/lr_model.pkl\")\n",
    "joblib.dump(iso_model, \"models/iso_model.pkl\")\n",
    "print(\"Saved all models to models/ directory.\")\n"
]

nb["cells"][export_idx]["source"] = new_export_source

with open("backend/train.ipynb", "w") as f:
    json.dump(nb, f, indent=2)

print("train.ipynb updated successfully!")
