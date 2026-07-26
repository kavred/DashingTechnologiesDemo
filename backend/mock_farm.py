import asyncio
import time
import random
from typing import Dict, List, Optional

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
        
        # Consumables
        self.spool_remaining_g = round(random.uniform(680.0, 960.0), 1)
        self.spool_capacity_g = 1000.0
        self.spool_type = spool_type
        self.spool_color = spool_color
        self.total_plates_ejected = random.randint(14, 89)

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
        # Hotend
        if self.current_hotend_temp < self.target_hotend_temp:
            heating_rate = 8.5 * dt
            self.current_hotend_temp = min(self.target_hotend_temp, self.current_hotend_temp + heating_rate)
        elif self.current_hotend_temp > self.target_hotend_temp:
            cooling_rate = 2.5 * dt
            self.current_hotend_temp = max(23.5, self.current_hotend_temp - cooling_rate)
            
        if abs(self.current_hotend_temp - self.target_hotend_temp) < 2.0 and self.target_hotend_temp > 50:
            self.current_hotend_temp += random.uniform(-0.3, 0.3)
            
        # Bed
        if self.current_bed_temp < self.target_bed_temp:
            bed_heat_rate = 3.0 * dt
            self.current_bed_temp = min(self.target_bed_temp, self.current_bed_temp + bed_heat_rate)
        elif self.current_bed_temp > self.target_bed_temp:
            bed_cool_rate = 1.0 * dt
            self.current_bed_temp = max(22.0, self.current_bed_temp - bed_cool_rate)
            
        if abs(self.current_bed_temp - self.target_bed_temp) < 1.5 and self.target_bed_temp > 30:
            self.current_bed_temp += random.uniform(-0.15, 0.15)
            
        # Chamber
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
        self.nodes: Dict[str, MockPrinterNode] = {
            "node-01": MockPrinterNode("node-01", "Node 1", "#10b981", "PLA+ Tough Black"),
            "node-02": MockPrinterNode("node-02", "Node 2", "#3b82f6", "PETG Carbon"),
            "node-03": MockPrinterNode("node-03", "Node 3", "#a855f7", "ABS White"),
            "node-04": MockPrinterNode("node-04", "Node 4", "#f59e0b", "TPU Orange")
        }
        
        # Single Plate Ejection Queue Lock
        self.active_ejecting_node_id: Optional[str] = None
        self.ejection_queue: List[str] = [] # List of node_ids waiting to eject
        
        # Global Print Jobs Queue
        self.global_queue: List[dict] = [
            {
                "job_id": "JOB-9041",
                "filename": "Turbine_Impeller_v3.3mf",
                "file_type": "3MF",
                "mass_g": 64.2,
                "total_layers": 310,
                "estimated_duration_s": 35,
                "target_hotend": 225.0,
                "target_bed": 60.0,
                "priority": "HIGH",
                "created_at": "11:00:15",
                "auto_routed_node": "Node 1"
            },
            {
                "job_id": "JOB-9042",
                "filename": "Drone_Arm_Mount_Reinforced.stl",
                "file_type": "STL",
                "mass_g": 88.5,
                "total_layers": 420,
                "estimated_duration_s": 45,
                "target_hotend": 240.0,
                "target_bed": 75.0,
                "priority": "NORMAL",
                "created_at": "11:01:02",
                "auto_routed_node": "Node 2"
            }
        ]
        
        # Pre-load initial active jobs
        self.nodes["node-01"].assign_job({
            "job_id": "JOB-9039",
            "filename": "Rocket_Nozzle_Bracket.stl",
            "file_type": "STL",
            "mass_g": 52.0,
            "total_layers": 280,
            "estimated_duration_s": 35,
            "target_hotend": 220.0,
            "target_bed": 60.0
        })
        self.nodes["node-01"].status = "PRINTING"
        self.nodes["node-01"].current_hotend_temp = 219.8
        self.nodes["node-01"].current_bed_temp = 60.0
        self.nodes["node-01"].progress = 55.0
        self.nodes["node-01"].elapsed_time_s = 19

        self.nodes["node-02"].assign_job({
            "job_id": "JOB-9040",
            "filename": "Cyber_Chassis_Plate.3mf",
            "file_type": "3MF",
            "mass_g": 110.0,
            "total_layers": 500,
            "estimated_duration_s": 40,
            "target_hotend": 240.0,
            "target_bed": 75.0
        })
        self.nodes["node-02"].status = "PRINTING"
        self.nodes["node-02"].current_hotend_temp = 239.5
        self.nodes["node-02"].current_bed_temp = 74.8
        self.nodes["node-02"].progress = 90.0
        self.nodes["node-02"].elapsed_time_s = 36

        self.total_processed_today = 142
        self.total_cad_dispatched = 89

    def request_ejection(self, node_id: str):
        """
        Ensures ONLY ONE plate is ejected at a time across the entire farm!
        If another plate is ejecting, queues the node up to wait its turn.
        """
        node = self.nodes.get(node_id)
        if not node:
            return

        if self.active_ejecting_node_id is None:
            # Grant ejection lock immediately!
            self.active_ejecting_node_id = node_id
            node.status = "EJECTING"
            node.eject_countdown_s = 5
            node.target_hotend_temp = 0.0
            node.target_bed_temp = 0.0
            node.fan_rpm = 800
            node.extruding_rate = 0.0
        else:
            # Another node is currently ejecting! Queue this node.
            if node_id != self.active_ejecting_node_id and node_id not in self.ejection_queue:
                self.ejection_queue.append(node_id)
                node.status = "WAITING FOR EJECT"
                node.target_hotend_temp = 0.0
                node.target_bed_temp = 0.0
                node.extruding_rate = 0.0

    def tick(self, dt: float = 0.5):
        """Ticks physical simulation and manages the single-ejector queue."""
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
                
                # Print complete -> Request plate ejection!
                if node.progress >= 100.0:
                    self.request_ejection(node.node_id)

            elif node.status == "EJECTING":
                node.eject_countdown_s -= dt
                node.fan_rpm = 2000
                if node.eject_countdown_s <= 0:
                    # Ejection finished! Release lock and check queue
                    node.total_plates_ejected += 1
                    node.status = "IDLE"
                    node.current_job = None
                    node.progress = 0.0
                    node.current_layer = 0
                    node.total_layers = 0
                    node.eject_countdown_s = 0
                    node.fan_rpm = 0
                    
                    # Release active lock
                    self.active_ejecting_node_id = None
                    
                    # Promote next waiting node in ejection queue
                    if self.ejection_queue:
                        next_node_id = self.ejection_queue.pop(0)
                        self.request_ejection(next_node_id)

            elif node.status == "IDLE":
                node.target_hotend_temp = 0.0
                node.target_bed_temp = 0.0
                node.fan_rpm = 0
                node.extruding_rate = 0.0
                
                # Auto-assign next job from global print queue
                if len(self.global_queue) > 0:
                    next_job = self.global_queue.pop(0)
                    node.assign_job(next_job)

    def add_cad_file(self, filename: str, file_size_kb: float) -> dict:
        ext = filename.split(".")[-1].upper() if "." in filename else "CAD"
        estimated_mass = round(random.uniform(25.0, 120.0), 1)
        estimated_duration = random.randint(25, 45)
        total_layers = int(estimated_mass * 4.0)

        job_id = f"JOB-{random.randint(9045, 9999)}"
        new_job = {
            "job_id": job_id,
            "filename": filename,
            "file_type": ext,
            "mass_g": estimated_mass,
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
        
        return {
            "timestamp": time.time(),
            "fleet_summary": {
                "active_nodes": active_nodes_count,
                "total_nodes": len(self.nodes),
                "queue_length": len(self.global_queue),
                "ejection_queue_length": len(self.ejection_queue),
                "active_ejecting_node": self.active_ejecting_node_id,
                "total_plates_ejected": total_plates_ejected,
                "total_processed_today": self.total_processed_today + total_plates_ejected,
                "total_cad_dispatched": self.total_cad_dispatched,
                "farm_health_score": 98.4
            },
            "nodes": nodes_data,
            "queue": self.global_queue
        }
