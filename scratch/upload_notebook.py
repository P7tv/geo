import json
import os
import requests

JUPYTERHUB_URL = "http://swarm-manager.modelharbor.com:56751/user/scam"
TOKEN = "9583a8805b4946b7984944cbd40dc83e"

headers = {
    "Authorization": f"token {TOKEN}"
}

def upload_notebook():
    local_path = "/Users/panpan/geo/train_yolo.ipynb"
    remote_path = "workspace/geo/train_yolo.ipynb"
    
    print(f"Reading {local_path}...")
    with open(local_path, "r", encoding="utf-8") as f:
        notebook_json = json.load(f)
        
    url = f"{JUPYTERHUB_URL}/api/contents/{remote_path}"
    payload = {
        "name": os.path.basename(remote_path),
        "path": remote_path,
        "type": "notebook",
        "format": "json",
        "content": notebook_json
    }
    
    print(f"Uploading to JupyterHub Contents API: {remote_path}...")
    res = requests.put(url, headers=headers, json=payload)
    if res.status_code in [200, 201]:
        print("✅ Notebook uploaded successfully to B200 VM!")
    else:
        print(f"❌ Upload failed: {res.status_code} - {res.text}")

if __name__ == "__main__":
    upload_notebook()
