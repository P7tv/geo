import os
import requests
from pathlib import Path

ROOT = Path(__file__).parent.parent
API_KEY = "floodnav-56f38b6dc2e659d0"

print("="*50)
print("🗺️  FloodNav Graph Status Checker (B200)")
print("="*50)

# 1. Check generated .pkl files on disk
print("📁 1. Generated Graph Files on Disk:")
pkl_files = list(ROOT.glob("*_graph.pkl"))
if not pkl_files:
    print("   ❌ No graph files found on disk.")
else:
    for f in pkl_files:
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"   ✅ {f.name} ({size_mb:.1f} MB)")

print("\n🧠 2. Graphs Currently Loaded in RAM:")
try:
    res = requests.get(
        "http://127.0.0.1:8087/route/health",
        headers={"X-API-Key": API_KEY},
        timeout=2
    )
    if res.status_code == 200:
        data = res.json()
        loaded = data.get('loaded_graphs', [])
        mem = data.get('memoryUsedGB', 0)
        print(f"   💾 System Memory Used: {mem} GB")
        if not loaded:
            print("   ⚠️ No graphs are currently loaded in RAM.")
        else:
            for g in loaded:
                print(f"   🚀 Loaded: {g}")
    else:
        print(f"   ❌ API returned error code: {res.status_code} (Is API key correct?)")
except Exception as e:
    print(f"   ❌ Cannot connect to FastAPI server (Is it running on port 8087?)")

print("="*50)
