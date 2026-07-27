import asyncio
import time
import random
from typing import Dict, List, Optional

PRESET_CAD_SPECS = {
    "Turbine_Impeller_V4.3mf": (64.2, 310, 35),
    "Turbine_Impeller_v3.3mf": (64.2, 310, 35),
    "Drone_Motor_Chassis.step": (88.5, 420, 45),
    "Drone_Arm_Mount_Reinforced.stl": (88.5, 420, 45),
    "Surgical_Guide_Plate.stl": (35.0, 180, 30),
    "Rocket_Nozzle_Bracket.stl": (52.0, 280, 35),
    "Cyber_Chassis_Plate.3mf": (110.0, 500, 40),
    "Aero_Bracket_V2.3mf": (75.0, 360, 38)
}

def get_deterministic_cad_specs(filename: str):
    """
    Ensures every CAD model uses the EXACT SAME amount of filament (mass in grams),
    total layers, and duration regardless of which printer node prints it.
    """
    if filename in PRESET_CAD_SPECS:
        return PRESET_CAD_SPECS[filename]
    
    # Hash formula for consistent specs based on filename
    h = sum(ord(c) * (i + 1) for i, c in enumerate(filename))
    mass_g = round(25.0 + (h % 950) / 10.0, 1) # 25.0g to 120.0g
    total_layers = int(mass_g * 4.0)
    estimated_duration = 25 + (h % 20) # 25s to 45s
    return mass_g, total_layers, estimated_duration


class MockPrinterNode:
    """
    Simulates a 3D Printer Node (Node 1, Node 2, Node 3, Node 4)
    with physical thermal dynamics, layer tracking, spool usage, and queued plate ejection.
    """
    def __init__(self, node_id: str, name: str, spool_color: str, spool_type: str):
        self.node_id = node_id
        self.name = name
        
        # State Machine: "IDLE", "PREHEATING", "PRINTING", "WAITING FOR EJECT", "EJECTING"
        self.status = "IDLE"
        
        # Telemetry
        self.target_hotend_temp = 0.0
        self.current_hotend_temp = 23.5  # Ambient start
        self.target_bed_temp = 0.0
        self.current_bed_temp = 22.0     # Ambient start
        
        self.fan_rpm = 0
        self.chamber_temp = 24.0
        self.extruding_rate = 0.0 # mm3/s
        
        # Current active job
        self.current_job: Optional[dict] = None
        self.progress = 0.0
        self.current_layer = 0
        self.total_layers = 0
        self.elapsed_time_s = 0
        self.estimated_duration_s = 0
        
        # Swapper Ejection Countdown
        self.eject_countdown_s = 0
        
        # Consumables (Default spools match valid Restock options)
        self.spool_remaining_g = 1000.0
        self.spool_capacity_g = 1000.0
        self.spool_type = spool_type
        self.spool_color = spool_color
        self.total_plates_ejected = 0

    def assign_job(self, job: dict):
        """Assigns a job and sets printer to preheating."""
        self.current_job = job
        self.progress = 0.0
        self.current_layer = 1
        self.total_layers = job.get("total_layers", 250)
        self.elapsed_time_s = 0
        self.estimated_duration_s = job.get("estimated_duration_s", 40)
        
        self.target_hotend_temp = job.get("target_hotend", 220.0)
        self.target_bed_temp = job.get("target_bed", 60.0)
            
        self.status = "PREHEATING"
        self.fan_rpm = 1200

    def tick_thermal(self, dt: float = 0.5):
        """Simulates physical thermal dynamics."""
        if self.current_hotend_temp < self.target_hotend_temp:
            heating_rate = 8.5 * dt
            self.current_hotend_temp = min(self.target_hotend_temp, self.current_hotend_temp + heating_rate)
        elif self.current_hotend_temp > self.target_hotend_temp:
            cooling_rate = 2.5 * dt
            self.current_hotend_temp = max(23.5, self.current_hotend_temp - cooling_rate)
            
        if abs(self.current_hotend_temp - self.target_hotend_temp) < 2.0 and self.target_hotend_temp > 50:
            self.current_hotend_temp += random.uniform(-0.3, 0.3)
            
        if self.current_bed_temp < self.target_bed_temp:
            bed_heat_rate = 3.0 * dt
            self.current_bed_temp = min(self.target_bed_temp, self.current_bed_temp + bed_heat_rate)
        elif self.current_bed_temp > self.target_bed_temp:
            bed_cool_rate = 1.0 * dt
            self.current_bed_temp = max(22.0, self.current_bed_temp - bed_cool_rate)
            
        if abs(self.current_bed_temp - self.target_bed_temp) < 1.5 and self.target_bed_temp > 30:
            self.current_bed_temp += random.uniform(-0.15, 0.15)
            
        if self.status in ["PREHEATING", "PRINTING"]:
            self.chamber_temp = min(48.0, self.chamber_temp + 0.1 * dt)
        else:
            self.chamber_temp = max(24.0, self.chamber_temp - 0.15 * dt)
            
        self.current_hotend_temp = round(self.current_hotend_temp, 1)
        self.current_bed_temp = round(self.current_bed_temp, 1)
        self.chamber_temp = round(self.chamber_temp, 1)

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "name": self.name,
            "status": self.status,
            "current_hotend_temp": self.current_hotend_temp,
            "target_hotend_temp": self.target_hotend_temp,
            "current_bed_temp": self.current_bed_temp,
            "target_bed_temp": self.target_bed_temp,
            "chamber_temp": self.chamber_temp,
            "fan_rpm": self.fan_rpm,
            "extruding_rate": self.extruding_rate,
            "progress": self.progress,
            "current_layer": self.current_layer,
            "total_layers": self.total_layers,
            "elapsed_time_s": int(self.elapsed_time_s),
            "estimated_duration_s": self.estimated_duration_s,
            "eject_countdown_s": max(0, int(self.eject_countdown_s)),
            "spool": {
                "remaining_g": self.spool_remaining_g,
                "capacity_g": self.spool_capacity_g,
                "pct": round((self.spool_remaining_g / self.spool_capacity_g) * 100, 1),
                "type": self.spool_type,
                "color": self.spool_color
            },
            "plates_ejected": self.total_plates_ejected,
            "current_job": self.current_job
        }


class PrintFarmManager:
    """
    Central farm manager orchestrating 4 nodes (Node 1, Node 2, Node 3, Node 4),
    global queue, and SINGLE-PLATE-AT-A-TIME robotic ejection queue.
    """
    def __init__(self):
        # Default initial spools match Restock modal options (OEM PLA, OEM PETG, OEM ABS, OEM TPU)
        self.nodes: Dict[str, MockPrinterNode] = {
            "node-01": MockPrinterNode("node-01", "Node 1", "#10b981", "OEM PLA"),
            "node-02": MockPrinterNode("node-02", "Node 2", "#3b82f6", "OEM PETG"),
            "node-03": MockPrinterNode("node-03", "Node 3", "#a855f7", "OEM ABS"),
            "node-04": MockPrinterNode("node-04", "Node 4", "#f59e0b", "OEM TPU")
        }
        
        # Single Plate Ejection Queue Lock
        self.active_ejecting_node_id: Optional[str] = None
        self.ejection_queue: List[str] = []
        
        # Global Print Jobs Queue
        self.global_queue: List[dict] = []
        
        self.total_processed_today = 0
        self.total_cad_dispatched = 0

    def request_ejection(self, node_id: str):
        node = self.nodes.get(node_id)
        if not node:
            return

        if self.active_ejecting_node_id is None:
            self.active_ejecting_node_id = node_id
            node.status = "EJECTING"
            node.eject_countdown_s = 5
            node.target_hotend_temp = 0.0
            node.target_bed_temp = 0.0
            node.fan_rpm = 800
            node.extruding_rate = 0.0
        else:
            if node_id != self.active_ejecting_node_id and node_id not in self.ejection_queue:
                self.ejection_queue.append(node_id)
                node.status = "WAITING FOR EJECT"
                node.target_hotend_temp = 0.0
                node.target_bed_temp = 0.0
                node.extruding_rate = 0.0

    def cancel_job(self, node_id: str):
        """
        Cancels an active print job.
        Since print material is on the bed, ejection is automatically requested
        so the robotic arm clears the canceled plate!
        """
        node = self.nodes.get(node_id)
        if not node:
            return
        if node.status in ["PRINTING", "PREHEATING", "PAUSED"] or node.current_job is not None:
            self.request_ejection(node_id)
        elif node.status not in ["EJECTING", "WAITING FOR EJECT"]:
            node.status = "IDLE"
            node.current_job = None
            node.progress = 0.0

    def pause_job(self, node_id: str):
        """
        Pauses an active print job.
        Holds execution: temperatures maintain target setpoints, progress holds.
        """
        node = self.nodes.get(node_id)
        if not node:
            return
        if node.status in ["PRINTING", "PREHEATING"]:
            node.status = "PAUSED"
            node.extruding_rate = 0.0
            node.fan_rpm = 1500

    def resume_job(self, node_id: str):
        """Resumes a paused print job."""
        node = self.nodes.get(node_id)
        if not node:
            return
        if node.status == "PAUSED":
            hotend_ready = (node.target_hotend_temp - node.current_hotend_temp) <= 2.0
            bed_ready = (node.target_bed_temp - node.current_bed_temp) <= 2.0
            if hotend_ready and bed_ready:
                node.status = "PRINTING"
            else:
                node.status = "PREHEATING"

    def tick(self, dt: float = 0.5):
        for node in self.nodes.values():
            node.tick_thermal(dt)

            if node.status == "PREHEATING":
                hotend_ready = (node.target_hotend_temp - node.current_hotend_temp) <= 2.0
                bed_ready = (node.target_bed_temp - node.current_bed_temp) <= 2.0
                if hotend_ready and bed_ready:
                    node.status = "PRINTING"
                    node.fan_rpm = random.randint(4500, 6800)
                    node.extruding_rate = round(random.uniform(12.5, 24.0), 1)

            elif node.status == "PRINTING":
                node.elapsed_time_s += dt
                progress_pct = (node.elapsed_time_s / node.estimated_duration_s) * 100.0
                node.progress = min(100.0, round(progress_pct, 1))
                
                if node.total_layers > 0:
                    node.current_layer = min(node.total_layers, max(1, int((node.progress / 100.0) * node.total_layers)))
                    
                filament_used_per_sec = (node.current_job.get("mass_g", 30.0) / node.estimated_duration_s) * dt
                node.spool_remaining_g = max(0.0, round(node.spool_remaining_g - filament_used_per_sec, 2))
                
                node.fan_rpm = random.randint(5200, 6400)
                node.extruding_rate = round(random.uniform(14.0, 22.0), 1)
                
                if node.progress >= 100.0:
                    self.request_ejection(node.node_id)

            elif node.status == "PAUSED":
                node.extruding_rate = 0.0
                node.fan_rpm = 1500

            elif node.status == "EJECTING":
                node.eject_countdown_s -= dt
                node.fan_rpm = 2000
                if node.eject_countdown_s <= 0:
                    node.total_plates_ejected += 1
                    node.status = "IDLE"
                    node.current_job = None
                    node.progress = 0.0
                    node.current_layer = 0
                    node.total_layers = 0
                    node.eject_countdown_s = 0
                    node.fan_rpm = 0
                    
                    self.active_ejecting_node_id = None
                    
                    if self.ejection_queue:
                        next_node_id = self.ejection_queue.pop(0)
                        self.request_ejection(next_node_id)

            elif node.status == "IDLE":
                node.target_hotend_temp = 0.0
                node.target_bed_temp = 0.0
                node.fan_rpm = 0
                node.extruding_rate = 0.0
                
                if len(self.global_queue) > 0:
                    next_job = self.global_queue.pop(0)
                    node.assign_job(next_job)

    def add_cad_file(self, filename: str, file_size_kb: float) -> dict:
        ext = "GCODE"
        gcode_filename = filename.rsplit(".", 1)[0] + ".gcode" if "." in filename else f"{filename}.gcode"
        mass_g, total_layers, estimated_duration = get_deterministic_cad_specs(filename)

        job_id = f"JOB-{random.randint(9045, 9999)}"
        new_job = {
            "job_id": job_id,
            "filename": gcode_filename,
            "file_type": ext,
            "mass_g": mass_g,
            "total_layers": total_layers,
            "estimated_duration_s": estimated_duration,
            "target_hotend": 225.0,
            "target_bed": 60.0,
            "priority": "HIGH (AUTO)",
            "created_at": time.strftime("%H:%M:%S"),
            "auto_routed_node": "Node 3"
        }
        
        self.global_queue.append(new_job)
        self.total_cad_dispatched += 1
        self.tick(0.1)
        
        return new_job

    def get_telemetry(self) -> dict:
        nodes_data = {node_id: node.to_dict() for node_id, node in self.nodes.items()}
        active_nodes_count = sum(1 for n in self.nodes.values() if n.status in ["PREHEATING", "PRINTING", "EJECTING", "WAITING FOR EJECT"])
        total_plates_ejected = sum(n.total_plates_ejected for n in self.nodes.values())
        
        summary = {
            "active_nodes": active_nodes_count,
            "total_nodes": len(self.nodes),
            "queue_length": len(self.global_queue),
            "ejection_queue_length": len(self.ejection_queue),
            "active_ejecting_node": self.active_ejecting_node_id,
            "total_plates_ejected": total_plates_ejected,
            "total_processed_today": self.total_processed_today + total_plates_ejected,
            "total_cad_dispatched": self.total_cad_dispatched,
            "farm_health_score": 98.4
        }
        
        return {
            "timestamp": time.time(),
            "farm_summary": summary,
            "fleet_summary": summary,
            "nodes": nodes_data,
            "queue": self.global_queue
        }
