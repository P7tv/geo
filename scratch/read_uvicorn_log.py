import json
import requests
import websocket
import uuid

JUPYTERHUB_URL = "http://swarm-manager.modelharbor.com:56751/user/scam"
TOKEN = "9583a8805b4946b7984944cbd40dc83e"

headers = {
    "Authorization": f"token {TOKEN}"
}

def execute_remote_code(code):
    kernel_url = f"{JUPYTERHUB_URL}/api/kernels"
    res = requests.post(kernel_url, headers=headers)
    if res.status_code != 201:
        print(f"❌ Failed to launch kernel: {res.status_code} - {res.text}")
        raise Exception("Kernel launch failed")
        
    kernel_id = res.json()["id"]
    ws_url = f"ws://swarm-manager.modelharbor.com:56751/user/scam/api/kernels/{kernel_id}/channels?token={TOKEN}"
    
    headers_ws = [
        f"Authorization: token {TOKEN}"
    ]
    ws = websocket.create_connection(
        ws_url,
        header=headers_ws,
        origin="http://swarm-manager.modelharbor.com:56751"
    )
    
    session_id = str(uuid.uuid4())
    msg_id = str(uuid.uuid4())
    
    execute_msg = {
        "header": {
            "msg_id": msg_id,
            "username": "scam",
            "session": session_id,
            "msg_type": "execute_request",
            "version": "5.3"
        },
        "metadata": {},
        "content": {
            "code": code,
            "silent": False,
            "store_history": True,
            "user_expressions": {},
            "allow_stdin": False
        },
        "buffers": [],
        "parent_header": {},
        "channel": "shell"
    }
    
    ws.send(json.dumps(execute_msg))
    
    ws.settimeout(15.0)
    outputs = []
    try:
        while True:
            msg = json.loads(ws.recv())
            msg_type = msg.get("msg_type")
            channel = msg.get("channel")
            
            if channel == "iopub":
                if msg_type == "stream":
                    text = msg["content"].get("text", "")
                    print(text, end="")
                    outputs.append(text)
                elif msg_type == "error":
                    ename = msg["content"].get("ename")
                    evalue = msg["content"].get("evalue")
                    traceback = msg["content"].get("traceback")
                    print(f"❌ Remote error: {ename}: {evalue}")
                    print("\n".join(traceback))
                    outputs.append(f"Error: {ename}: {evalue}")
            elif channel == "shell" and msg_type == "execute_reply":
                break
    except Exception as e:
        print(f"WS Read Error: {e}")
            
    ws.close()
    delete_url = f"{JUPYTERHUB_URL}/api/kernels/{kernel_id}"
    requests.delete(delete_url, headers=headers)
    return "".join(outputs)

if __name__ == "__main__":
    code = """
import urllib.request
import zipfile
import shutil
import os

url = "https://github.com/ultralytics/yolov5/releases/download/v1.0/coco128.zip"
zip_path = "workspace/geo/coco128.zip"

print("Downloading COCO128 dataset to VM...")
try:
    urllib.request.urlretrieve(url, zip_path)
    print("Download completed! Extracting...")
    
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall("workspace/geo")
        
    dst_dataset = "workspace/geo/dataset"
    src_dataset = "workspace/geo/coco128"
    
    if os.path.exists(dst_dataset):
        shutil.rmtree(dst_dataset)
    os.rename(src_dataset, dst_dataset)
    os.remove(zip_path)
    print("✅ COCO128 dataset successfully ready at workspace/geo/dataset!")
except Exception as e:
    print("❌ Failed to download/extract dataset:", e)
"""
    execute_remote_code(code)
