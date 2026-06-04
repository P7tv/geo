import json
import os
import requests
import websocket
import uuid

JUPYTERHUB_URL = "http://swarm-manager.modelharbor.com:56751/user/scam"
TOKEN = "9583a8805b4946b7984944cbd40dc83e"

headers = {
    "Authorization": f"token {TOKEN}"
}

def upload_file(local_path, remote_path):
    print(f"Reading local {local_path}...")
    with open(local_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    url = f"{JUPYTERHUB_URL}/api/contents/{remote_path}"
    payload = {
        "name": os.path.basename(remote_path),
        "path": remote_path,
        "type": "file",
        "format": "text",
        "content": content
    }
    
    print(f"Uploading to JupyterHub Contents API: {remote_path}...")
    res = requests.put(url, headers=headers, json=payload)
    if res.status_code in [200, 201]:
        print(f"✅ {local_path} uploaded successfully!")
        return True
    else:
        print(f"❌ Upload failed: {res.status_code} - {res.text}")
        return False

def restart_remote_uvicorn():
    print("Executing remote command to kill uvicorn (which will trigger watchdog to reload new code)...")
    kernel_url = f"{JUPYTERHUB_URL}/api/kernels"
    res = requests.post(kernel_url, headers=headers)
    if res.status_code != 201:
        print(f"❌ Failed to launch kernel: {res.status_code} - {res.text}")
        return
        
    kernel_id = res.json()["id"]
    ws_url = f"ws://swarm-manager.modelharbor.com:56751/user/scam/api/kernels/{kernel_id}/channels?token={TOKEN}"
    
    headers_ws = [f"Authorization: token {TOKEN}"]
    ws = websocket.create_connection(ws_url, header=headers_ws, origin="http://swarm-manager.modelharbor.com:56751")
    
    session_id = str(uuid.uuid4())
    msg_id = str(uuid.uuid4())
    
    # Python code to kill any existing uvicorn process
    code = """
import os
import signal
import subprocess

print("Finding and killing uvicorn main:app processes...")
try:
    # Use pgrep to find uvicorn main:app PIDs
    pids = subprocess.check_output(["pgrep", "-f", "uvicorn main:app"]).decode().strip().split()
    for pid in pids:
        pid = int(pid)
        print(f"Killing process PID {pid}")
        os.kill(pid, signal.SIGTERM)
    print("✅ Successfully triggered restart.")
except Exception as e:
    print("No uvicorn processes found or error:", e)
"""
    
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
    
    ws.settimeout(10.0)
    try:
        while True:
            msg = json.loads(ws.recv())
            if msg.get("channel") == "iopub" and msg.get("msg_type") == "stream":
                print(msg["content"].get("text", ""), end="")
            elif msg.get("channel") == "shell" and msg.get("msg_type") == "execute_reply":
                break
    except Exception as e:
        print(f"WS Read Error: {e}")
        
    ws.close()
    delete_url = f"{JUPYTERHUB_URL}/api/kernels/{kernel_id}"
    requests.delete(delete_url, headers=headers)
    print("Remote kernel cleaned up.")

if __name__ == "__main__":
    if upload_file("/Users/panpan/geo/backend/main.py", "workspace/geo/main.py"):
        restart_remote_uvicorn()
