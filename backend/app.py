import asyncio
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from mock_farm import PrintFarmManager

app = FastAPI(title="Autonomous Print Farm Management API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared Farm Manager instance
farm_manager = PrintFarmManager()

# Connected WebSocket Clients Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)

manager = ConnectionManager()

# Background Simulation Loop (Runs at 2Hz / 500ms interval)
async def simulation_loop():
    while True:
        try:
            farm_manager.tick(dt=0.5)
            telemetry = farm_manager.get_telemetry()
            await manager.broadcast(telemetry)
        except Exception as e:
            print(f"Error in simulation loop: {e}")
        await asyncio.sleep(0.5)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(simulation_loop())

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Send initial immediate snapshot
        await websocket.send_json(farm_manager.get_telemetry())
        while True:
            # Keep socket alive and receive incoming client commands if any
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                action = payload.get("action")
                if action == "zero_touch_drop":
                    filename = payload.get("filename", "Model_Auto_Upload.3mf")
                    file_size = payload.get("file_size_kb", 2500)
                    job_info = farm_manager.add_cad_file(filename, file_size)
                    await websocket.send_json({"event": "cad_processed", "job": job_info})
            except Exception as e:
                print(f"WebSocket command error: {e}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# REST APIs
@app.get("/api/telemetry")
async def get_telemetry():
    return farm_manager.get_telemetry()

@app.post("/api/upload-gcode")
@app.post("/api/upload-cad")
async def upload_gcode(file: UploadFile = File(...)):
    filename = file.filename if file.filename else "Uploaded_Part.gcode"
    content = await file.read()
    file_size_kb = len(content) / 1024.0
    job = farm_manager.add_gcode_file(filename, file_size_kb)
    return {"status": "success", "job": job, "message": "G-Code parsing and auto-routing complete."}

class DemoCADRequest(BaseModel):
    filename: str
    file_size_kb: float = 4200.0

@app.post("/api/demo-upload")
async def demo_upload(req: DemoCADRequest):
    job = farm_manager.add_cad_file(req.filename, req.file_size_kb)
    return {"status": "success", "job": job}

@app.post("/api/printers/{node_id}/action")
async def printer_action(
    node_id: str,
    action: str = Form(...),
    brand: str = Form(None),
    material: str = Form(None),
    color: str = Form(None),
    weight: float = Form(None)
):
    if node_id not in farm_manager.nodes:
        raise HTTPException(status_code=404, detail="Printer Node not found")
    node = farm_manager.nodes[node_id]
    
    if action == "force_eject":
        farm_manager.request_ejection(node_id)
    elif action == "pause":
        farm_manager.pause_job(node_id)
    elif action == "resume":
        farm_manager.resume_job(node_id)
    elif action == "cancel":
        farm_manager.cancel_job(node_id)
    elif action == "restock_spool":
        spool_weight = weight if weight else 1000.0
        node.spool_remaining_g = spool_weight
        node.spool_capacity_g = spool_weight
        node.spool_type = "Generic ASA"
        if color:
            node.spool_color = color
    return {"status": "success", "node": node.to_dict()}

@app.delete("/api/queue/{job_id}")
async def cancel_queue_job(job_id: str):
    farm_manager.global_queue = [j for j in farm_manager.global_queue if j["job_id"] != job_id]
    return {"status": "success", "queue": farm_manager.global_queue}

# Serve Frontend static files
root_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
frontend_path = os.path.join(root_path, "frontend") if os.path.exists(os.path.join(root_path, "frontend", "index.html")) else root_path

app.mount("/static", StaticFiles(directory=root_path), name="static")

@app.get("/")
async def read_root():
    index_file = os.path.join(root_path, "index.html")
    if not os.path.exists(index_file):
        index_file = os.path.join(frontend_path, "index.html")
    return FileResponse(index_file)

@app.get("/styles.css")
async def get_styles():
    css_file = os.path.join(root_path, "styles.css")
    if not os.path.exists(css_file):
        css_file = os.path.join(frontend_path, "styles.css")
    return FileResponse(css_file)

@app.get("/app.js")
async def get_js():
    js_file = os.path.join(root_path, "app.js")
    if not os.path.exists(js_file):
        js_file = os.path.join(frontend_path, "app.js")
    return FileResponse(js_file)

