import osmnx as ox
import pickle
from pathlib import Path
import sys
import time

ROOT = Path(__file__).parent.parent

PROVINCE_EN_MAP = {
    'เชียงราย': 'Chiang Rai Province, Thailand',
    'เชียงใหม่': 'Chiang Mai Province, Thailand',
    'น่าน': 'Nan Province, Thailand',
    'พะเยา': 'Phayao Province, Thailand',
    'แพร่': 'Phrae Province, Thailand',
    'นครสวรรค์': 'Nakhon Sawan Province, Thailand',
    'กรุงเทพมหานคร': 'Bangkok, Thailand',
    'ขอนแก่น': 'Khon Kaen Province, Thailand',
    'อุบลราชธานี': 'Ubon Ratchathani Province, Thailand',
    'สุราษฎร์ธานี': 'Surat Thani Province, Thailand',
    'ภูเก็ต': 'Phuket Province, Thailand',
    'สงขลา': 'Songkhla Province, Thailand',
}

def get_pkl_path(province_name: str) -> Path:
    en_name = PROVINCE_EN_MAP[province_name]
    filename = en_name.split(',')[0].strip().lower().replace(' ', '_') + '_graph.pkl'
    return ROOT / filename

print("="*60)
print("🌍 FloodNav - Multi-Province Graph Downloader")
print("="*60)

for th_name, en_name in PROVINCE_EN_MAP.items():
    pkl_path = get_pkl_path(th_name)
    if pkl_path.exists():
        # ถ้ามีไฟล์อยู่แล้ว และขนาดไม่เล็กผิดปกติ (ป้องกันไฟล์พัง)
        size_mb = pkl_path.stat().st_size / (1024 * 1024)
        if size_mb > 5.0 or "bangkok" in pkl_path.name or "phuket" in pkl_path.name:
            print(f"⏩ [SKIP] {en_name} already exists ({size_mb:.1f} MB)")
            continue
    
    print(f"📥 [DOWNLOADING] {en_name}...")
    t0 = time.time()
    try:
        # ใช้ retain_all=False (ค่าปริยาย) เพื่อลบจุดแยกย่อยที่ไปต่อไม่ได้ ลดขนาดไฟล์
        G = ox.graph_from_place(en_name, network_type="drive", simplify=True)
        with open(pkl_path, 'wb') as f:
            pickle.dump(G, f)
        elapsed = round((time.time() - t0) / 60, 1)
        print(f"   ✅ Success! {G.number_of_nodes():,} nodes ({elapsed} mins)")
    except Exception as e:
        print(f"   ❌ Error downloading {en_name}: {e}")

print("="*60)
print("🎉 All downloads completed!")
print("="*60)
