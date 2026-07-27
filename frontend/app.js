/**
 * DASING LABS // AUTOPRINT OS FRONTEND ENGINE
 * WebSocket Telemetry Manager & Standalone GitHub Pages Client Simulator Engine
 */

let ws = null;
let reconnectTimer = null;
let currentTelemetry = null;
let isDemoSimulatorMode = false;
let demoSimulatorInterval = null;

const PRESET_CAD_SPECS = {
  "Turbine_Impeller_V4.3mf": { mass_g: 64.2, total_layers: 310, estimated_duration_s: 35 },
  "Turbine_Impeller_v3.3mf": { mass_g: 64.2, total_layers: 310, estimated_duration_s: 35 },
  "Drone_Motor_Chassis.step": { mass_g: 88.5, total_layers: 420, estimated_duration_s: 45 },
  "Drone_Arm_Mount_Reinforced.stl": { mass_g: 88.5, total_layers: 420, estimated_duration_s: 45 },
  "Surgical_Guide_Plate.stl": { mass_g: 35.0, total_layers: 180, estimated_duration_s: 30 },
  "Rocket_Nozzle_Bracket.stl": { mass_g: 52.0, total_layers: 280, estimated_duration_s: 35 },
  "Cyber_Chassis_Plate.3mf": { mass_g: 110.0, total_layers: 500, estimated_duration_s: 40 },
  "Aero_Bracket_V2.3mf": { mass_g: 75.0, total_layers: 360, estimated_duration_s: 38 }
};

function getDeterministicCadSpecs(filename) {
  if (PRESET_CAD_SPECS[filename]) return PRESET_CAD_SPECS[filename];
  let h = 0;
  for (let i = 0; i < filename.length; i++) {
    h += filename.charCodeAt(i) * (i + 1);
  }
  const mass_g = Math.round((25.0 + (h % 950) / 10.0) * 10) / 10;
  const total_layers = Math.floor(mass_g * 4.0);
  const estimated_duration_s = 25 + (h % 20);
  return { mass_g, total_layers, estimated_duration_s };
}

// Standalone Demo Simulator State (Blank Slate Initial State)
let demoState = {
  active_ejecting_node: null,
  ejection_queue: [],
  total_cad_dispatched: 0,
  total_processed_today: 0,
  nodes: {
    "node-01": {
      node_id: "node-01",
      name: "Node 1",
      status: "IDLE",
      current_hotend_temp: 24.0,
      target_hotend_temp: 0.0,
      current_bed_temp: 22.0,
      target_bed_temp: 0.0,
      chamber_temp: 24.0,
      fan_rpm: 0,
      extruding_rate: 0.0,
      progress: 0.0,
      current_layer: 0,
      total_layers: 0,
      elapsed_time_s: 0,
      estimated_duration_s: 0,
      eject_countdown_s: 0,
      spool: { remaining_g: 1000.0, capacity_g: 1000.0, pct: 100.0, type: "OEM PLA", color: "#10b981" },
      plates_ejected: 0,
      current_job: null
    },
    "node-02": {
      node_id: "node-02",
      name: "Node 2",
      status: "IDLE",
      current_hotend_temp: 24.0,
      target_hotend_temp: 0.0,
      current_bed_temp: 22.0,
      target_bed_temp: 0.0,
      chamber_temp: 24.0,
      fan_rpm: 0,
      extruding_rate: 0.0,
      progress: 0.0,
      current_layer: 0,
      total_layers: 0,
      elapsed_time_s: 0,
      estimated_duration_s: 0,
      eject_countdown_s: 0,
      spool: { remaining_g: 1000.0, capacity_g: 1000.0, pct: 100.0, type: "OEM PETG", color: "#3b82f6" },
      plates_ejected: 0,
      current_job: null
    },
    "node-03": {
      node_id: "node-03",
      name: "Node 3",
      status: "IDLE",
      current_hotend_temp: 24.0,
      target_hotend_temp: 0.0,
      current_bed_temp: 22.0,
      target_bed_temp: 0.0,
      chamber_temp: 24.0,
      fan_rpm: 0,
      extruding_rate: 0.0,
      progress: 0.0,
      current_layer: 0,
      total_layers: 0,
      elapsed_time_s: 0,
      estimated_duration_s: 0,
      eject_countdown_s: 0,
      spool: { remaining_g: 1000.0, capacity_g: 1000.0, pct: 100.0, type: "OEM ABS", color: "#a855f7" },
      plates_ejected: 0,
      current_job: null
    },
    "node-04": {
      node_id: "node-04",
      name: "Node 4",
      status: "IDLE",
      current_hotend_temp: 24.0,
      target_hotend_temp: 0.0,
      current_bed_temp: 22.0,
      target_bed_temp: 0.0,
      chamber_temp: 24.0,
      fan_rpm: 0,
      extruding_rate: 0.0,
      progress: 0.0,
      current_layer: 0,
      total_layers: 0,
      elapsed_time_s: 0,
      estimated_duration_s: 0,
      eject_countdown_s: 0,
      spool: { remaining_g: 1000.0, capacity_g: 1000.0, pct: 100.0, type: "OEM TPU", color: "#f59e0b" },
      plates_ejected: 0,
      current_job: null
    }
  },
  queue: []
};

// Disclaimer Modal Helper Functions
function openDisclaimerModal() {
  const modal = document.getElementById("disclaimer-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeDisclaimerModal() {
  const modal = document.getElementById("disclaimer-modal");
  if (modal) modal.classList.add("hidden");
  try {
    localStorage.setItem("dasing_demo_disclaimer_seen", "true");
  } catch (e) {}
}

function checkFirstVisitDisclaimer() {
  try {
    const hasSeenDisclaimer = localStorage.getItem("dasing_demo_disclaimer_seen");
    if (!hasSeenDisclaimer) {
      openDisclaimerModal();
    }
  } catch (e) {
    openDisclaimerModal();
  }
}

// Initialize App on DOM Loaded
document.addEventListener("DOMContentLoaded", () => {
  initDragAndDrop();
  checkFirstVisitDisclaimer();

  // Render initial telemetry snapshot instantly on page load (0ms delay!)
  const initialTelemetry = getDemoTelemetrySnapshot();
  renderTelemetry(initialTelemetry);

  // If hosted on GitHub Pages or static host, start client simulator directly, or try WS with fast fallback
  const isGitHubPages = window.location.hostname.includes("github.io") || window.location.protocol === "file:";
  if (isGitHubPages) {
    startDemoSimulatorMode("ONLINE (GITHUB PAGES DEMO STREAM)");
  } else {
    initWebSocket();
  }
});

// --------------------------------------------------------------------------
// WebSockets Connection Manager
// --------------------------------------------------------------------------
function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

  const indicator = document.getElementById("ws-indicator");
  const statusText = document.getElementById("ws-status-text");

  statusText.textContent = "CONNECTING WS...";
  indicator.style.backgroundColor = "#f59e0b";

  let connectionTimeout = setTimeout(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log("WebSocket timeout. Switching to Standalone Demo Simulator.");
      if (ws) ws.close();
      startDemoSimulatorMode("ONLINE (DEMO SIMULATOR STREAM)");
    }
  }, 400);

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      statusText.textContent = "WS STREAM ONLINE (10 Hz)";
      indicator.style.backgroundColor = "#10b981";
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "cad_processed") {
          console.log("CAD Processed Event:", data.job);
          return;
        }
        currentTelemetry = data;
        renderTelemetry(data);
      } catch (e) {
        console.error("Failed to parse telemetry frame:", e);
      }
    };

    ws.onerror = (err) => {
      console.warn("WebSocket Connection Error, falling back to Demo Mode:", err);
      clearTimeout(connectionTimeout);
      startDemoSimulatorMode("ONLINE (DEMO SIMULATOR STREAM)");
    };

    ws.onclose = () => {
      if (!isDemoSimulatorMode) {
        startDemoSimulatorMode("ONLINE (DEMO SIMULATOR STREAM)");
      }
    };
  } catch (e) {
    startDemoSimulatorMode("ONLINE (DEMO SIMULATOR STREAM)");
  }
}

// --------------------------------------------------------------------------
// Standalone In-Browser Telemetry Simulation Engine (For GitHub Pages)
// --------------------------------------------------------------------------
function startDemoSimulatorMode(statusLabel = "ONLINE (GITHUB PAGES DEMO STREAM)") {
  if (isDemoSimulatorMode) return;
  isDemoSimulatorMode = true;

  const indicator = document.getElementById("ws-indicator");
  const statusText = document.getElementById("ws-status-text");

  if (statusText) statusText.textContent = statusLabel;
  if (indicator) indicator.style.backgroundColor = "#10b981";

  // Render initial frame immediately without waiting for first interval
  renderTelemetry(getDemoTelemetrySnapshot());

  if (demoSimulatorInterval) clearInterval(demoSimulatorInterval);

  demoSimulatorInterval = setInterval(() => {
    tickDemoSimulator(0.5);
    const telemetry = getDemoTelemetrySnapshot();
    renderTelemetry(telemetry);
  }, 500);
}

function tickDemoSimulator(dt = 0.5) {
  Object.keys(demoState.nodes).forEach((nodeId) => {
    const node = demoState.nodes[nodeId];

    // Thermal simulation
    if (node.current_hotend_temp < node.target_hotend_temp) {
      node.current_hotend_temp = Math.min(node.target_hotend_temp, node.current_hotend_temp + 8.5 * dt);
    } else if (node.current_hotend_temp > node.target_hotend_temp) {
      node.current_hotend_temp = Math.max(23.5, node.current_hotend_temp - 2.5 * dt);
    }
    if (Math.abs(node.current_hotend_temp - node.target_hotend_temp) < 2.0 && node.target_hotend_temp > 50) {
      node.current_hotend_temp += (Math.random() * 0.6 - 0.3);
    }

    if (node.current_bed_temp < node.target_bed_temp) {
      node.current_bed_temp = Math.min(node.target_bed_temp, node.current_bed_temp + 3.0 * dt);
    } else if (node.current_bed_temp > node.target_bed_temp) {
      node.current_bed_temp = Math.max(22.0, node.current_bed_temp - 1.0 * dt);
    }

    node.current_hotend_temp = Math.round(node.current_hotend_temp * 10) / 10;
    node.current_bed_temp = Math.round(node.current_bed_temp * 10) / 10;

    // State machine logic
    if (node.status === "PREHEATING") {
      if ((node.target_hotend_temp - node.current_hotend_temp) <= 2.0 && (node.target_bed_temp - node.current_bed_temp) <= 2.0) {
        node.status = "PRINTING";
        node.fan_rpm = Math.floor(Math.random() * 2000) + 4800;
        node.extruding_rate = Math.round((Math.random() * 10 + 12) * 10) / 10;
      }
    } else if (node.status === "PRINTING") {
      node.elapsed_time_s += dt;
      const pct = (node.elapsed_time_s / node.estimated_duration_s) * 100.0;
      node.progress = Math.min(100.0, Math.round(pct * 10) / 10);
      if (node.total_layers > 0) {
        node.current_layer = Math.min(node.total_layers, Math.max(1, Math.floor((node.progress / 100.0) * node.total_layers)));
      }

      // Spool consumption
      const massG = node.current_job ? node.current_job.mass_g : 30.0;
      const filamentUsed = (massG / node.estimated_duration_s) * dt;
      node.spool.remaining_g = Math.max(0.0, Math.round((node.spool.remaining_g - filamentUsed) * 10) / 10);
      node.spool.pct = Math.round((node.spool.remaining_g / node.spool.capacity_g) * 1000) / 10;

      node.fan_rpm = Math.floor(Math.random() * 1200) + 5200;
      node.extruding_rate = Math.round((Math.random() * 8 + 14) * 10) / 10;

      if (node.progress >= 100.0) {
        requestDemoEjection(node.node_id);
      }
    } else if (node.status === "EJECTING") {
      node.eject_countdown_s -= dt;
      node.fan_rpm = 2000;
      if (node.eject_countdown_s <= 0) {
        node.plates_ejected += 1;
        node.status = "IDLE";
        node.current_job = null;
        node.progress = 0.0;
        node.current_layer = 0;
        node.total_layers = 0;
        node.eject_countdown_s = 0;
        node.fan_rpm = 0;
        demoState.active_ejecting_node = null;

        if (demoState.ejection_queue.length > 0) {
          const nextNodeId = demoState.ejection_queue.shift();
          requestDemoEjection(nextNodeId);
        }
      }
    } else if (node.status === "IDLE") {
      node.target_hotend_temp = 0.0;
      node.target_bed_temp = 0.0;
      node.fan_rpm = 0;
      node.extruding_rate = 0.0;

      if (demoState.queue.length > 0) {
        const nextJob = demoState.queue.shift();
        assignDemoJob(node, nextJob);
      }
    }
  });
}

function assignDemoJob(node, job) {
  node.current_job = job;
  node.progress = 0.0;
  node.current_layer = 1;
  node.total_layers = job.total_layers || 250;
  node.elapsed_time_s = 0;
  node.estimated_duration_s = job.estimated_duration_s || 35;
  node.target_hotend_temp = job.target_hotend || 220.0;
  node.target_bed_temp = job.target_bed || 60.0;
  node.status = "PREHEATING";
  node.fan_rpm = 1200;
}

function requestDemoEjection(nodeId) {
  const node = demoState.nodes[nodeId];
  if (!node) return;

  if (demoState.active_ejecting_node === null) {
    demoState.active_ejecting_node = nodeId;
    node.status = "EJECTING";
    node.eject_countdown_s = 5;
    node.target_hotend_temp = 0.0;
    node.target_bed_temp = 0.0;
    node.fan_rpm = 800;
    node.extruding_rate = 0.0;
  } else {
    if (nodeId !== demoState.active_ejecting_node && !demoState.ejection_queue.includes(nodeId)) {
      demoState.ejection_queue.push(nodeId);
      node.status = "WAITING FOR EJECT";
      node.target_hotend_temp = 0.0;
      node.target_bed_temp = 0.0;
      node.extruding_rate = 0.0;
    }
  }
}

function getDemoTelemetrySnapshot() {
  const nodes = demoState.nodes;
  const activeNodesCount = Object.values(nodes).filter(n => ["PREHEATING", "PRINTING", "EJECTING", "WAITING FOR EJECT"].includes(n.status)).length;
  const totalPlatesEjected = Object.values(nodes).reduce((acc, n) => acc + n.plates_ejected, 0);

  const summary = {
    active_nodes: activeNodesCount,
    total_nodes: Object.keys(nodes).length,
    queue_length: demoState.queue.length,
    ejection_queue_length: demoState.ejection_queue.length,
    active_ejecting_node: demoState.active_ejecting_node,
    total_plates_ejected: totalPlatesEjected,
    total_processed_today: demoState.total_processed_today + totalPlatesEjected,
    total_cad_dispatched: demoState.total_cad_dispatched,
    farm_health_score: 98.4
  };

  return {
    timestamp: Date.now() / 1000,
    farm_summary: summary,
    fleet_summary: summary,
    nodes: nodes,
    queue: demoState.queue
  };
}

// --------------------------------------------------------------------------
// Render Telemetry Dashboard
// --------------------------------------------------------------------------
function renderTelemetry(data) {
  if (!data) return;

  const farm = data.farm_summary || data.fleet_summary || {};
  const nodes = data.nodes || {};
  const queue = data.queue || [];

  const statActive = document.getElementById("stat-active-nodes");
  const statPlates = document.getElementById("stat-plates-ejected");
  const statCad = document.getElementById("stat-cad-dispatched");

  if (statActive) statActive.textContent = `${farm.active_nodes} / ${farm.total_nodes} ACTIVE`;
  if (statPlates) statPlates.textContent = farm.total_plates_ejected || 0;
  if (statCad) statCad.textContent = farm.total_cad_dispatched || 0;

  const footerSwapper = document.getElementById("footer-swapper-status");
  const isSwapperInUse = Boolean(
    farm.active_ejecting_node ||
    (farm.ejection_queue_length && farm.ejection_queue_length > 0) ||
    Object.values(nodes).some((n) => n.status === "EJECTING" || n.status === "WAITING FOR EJECT")
  );

  if (footerSwapper) {
    if (isSwapperInUse) {
      footerSwapper.textContent = "IN USE";
      footerSwapper.className = "text-amber";
    } else {
      footerSwapper.textContent = "READY";
      footerSwapper.className = "text-cyan";
    }
  }

  renderPrinterGrid(nodes);
  renderConsumables(nodes);
  renderQueue(queue);
}

// Render Printer Nodes (Node 1, Node 2, Node 3, Node 4)
// Uses in-place DOM updates to prevent hover-state flicker caused by innerHTML replacement.
function renderPrinterGrid(nodes) {
  const gridContainer = document.getElementById("printer-grid");
  if (!gridContainer) return;

  const nodeKeys = Object.keys(nodes).sort();

  // Build a set of expected card IDs so we can remove stale ones
  const expectedIds = new Set(nodeKeys.map((id) => `card-${id}`));

  // Remove cards that no longer exist in telemetry
  Array.from(gridContainer.children).forEach((child) => {
    if (!expectedIds.has(child.id)) child.remove();
  });

  nodeKeys.forEach((nodeId) => {
    const node = nodes[nodeId];
    const cardId = `card-${node.node_id}`;
    let card = document.getElementById(cardId);

    const statusClass = node.status.toLowerCase().replace(/\s+/g, '-');
    const isEjecting = node.status === "EJECTING";
    const isWaitingEject = node.status === "WAITING FOR EJECT";
    const isIdle = node.status === "IDLE";
    const isPrintActive = node.status === "PRINTING" || node.status === "PREHEATING" || node.status === "PAUSED";
    const job = node.current_job;

    // If card doesn't exist yet, create it from scratch once
    if (!card) {
      card = document.createElement("div");
      card.className = "printer-card";
      card.id = cardId;
      card.innerHTML = _buildPrinterCardInner(node, statusClass, isEjecting, isWaitingEject, isIdle, isPrintActive, job);
      gridContainer.appendChild(card);
      return;
    }

    // --- In-place updates for an existing card (no innerHTML nuke) ---

    // Status badge
    const badge = card.querySelector(".status-badge");
    if (badge) {
      badge.className = `status-badge ${statusClass}`;
      badge.textContent = node.status;
    }

    // Swapper / Waiting banner (structural change — only update when status category changes)
    const existingBanner = card.querySelector(".swapper-banner");
    if (isEjecting) {
      if (!existingBanner || existingBanner.classList.contains("waiting-banner")) {
        if (existingBanner) existingBanner.remove();
        const banner = document.createElement("div");
        banner.className = "swapper-banner";
        banner.innerHTML = `<span>EJECTING PLATE... SWAPPER MECHANISM ACTIVE</span><strong data-role="eject-countdown">${node.eject_countdown_s}s</strong>`;
        const header = card.querySelector(".printer-card-header");
        if (header) header.after(banner);
      } else {
        const cd = existingBanner.querySelector("[data-role='eject-countdown']") || existingBanner.querySelector("strong");
        if (cd) cd.textContent = `${node.eject_countdown_s}s`;
      }
    } else if (isWaitingEject) {
      if (!existingBanner || !existingBanner.classList.contains("waiting-banner")) {
        if (existingBanner) existingBanner.remove();
        const banner = document.createElement("div");
        banner.className = "swapper-banner waiting-banner";
        banner.innerHTML = `<span>WAITING FOR EJECTOR (QUEUED IN LINE)</span><strong>WAITING...</strong>`;
        const header = card.querySelector(".printer-card-header");
        if (header) header.after(banner);
      }
    } else {
      if (existingBanner) existingBanner.remove();
    }

    // Telemetry gauges — update text only
    const tempReadouts = card.querySelectorAll(".temp-readout");
    if (tempReadouts[0]) tempReadouts[0].textContent = `${node.current_hotend_temp}°C`;
    if (tempReadouts[1]) tempReadouts[1].textContent = `${node.current_bed_temp}°C`;

    const tempHeaders = card.querySelectorAll(".temp-header");
    if (tempHeaders[0]) {
      const spans = tempHeaders[0].querySelectorAll("span");
      if (spans[1]) spans[1].textContent = `T: ${node.target_hotend_temp}°C`;
    }
    if (tempHeaders[1]) {
      const spans = tempHeaders[1].querySelectorAll("span");
      if (spans[1]) spans[1].textContent = `T: ${node.target_bed_temp}°C`;
    }

    // Job filename & layer counter
    const jobFilename = card.querySelector(".job-filename");
    if (jobFilename) jobFilename.textContent = job ? job.filename : "No active job";
    const layerCounter = card.querySelector(".layer-counter");
    if (layerCounter) layerCounter.textContent = node.status === 'PRINTING' ? `Layer ${node.current_layer} / ${node.total_layers}` : "--";

    // Progress bar
    const progressFill = card.querySelector(".progress-fill");
    if (progressFill) progressFill.style.width = `${node.progress}%`;

    // Job meta footer
    const metaFooter = card.querySelector(".job-meta-footer");
    if (metaFooter) {
      const spans = metaFooter.querySelectorAll("span");
      if (spans[0]) spans[0].innerHTML = `PROGRESS: <strong>${node.progress}%</strong>`;
      if (spans[1]) spans[1].textContent = `FAN: ${node.fan_rpm} RPM`;
      if (spans[2]) spans[2].textContent = `RATE: ${node.extruding_rate} mm³/s`;
    }

    // Action buttons — only rebuild when the logical state category changes
    const actionsContainer = card.querySelector(".card-actions");
    if (actionsContainer) {
      const prevState = actionsContainer.dataset.state || "";
      let newState = "none";
      if (isIdle) newState = "idle";
      else if (isPrintActive) newState = `active-${node.status}`;

      if (prevState !== newState) {
        actionsContainer.dataset.state = newState;
        let actionsHtml = "";
        if (isIdle) {
          actionsHtml = `<button class="action-btn eject-btn" onclick="triggerNodeAction('${node.node_id}', 'force_eject')">Eject plate</button>`;
        } else if (isPrintActive) {
          actionsHtml = `
            <button class="action-btn" onclick="triggerNodeAction('${node.node_id}', '${node.status === 'PAUSED' ? 'resume' : 'pause'}')">
              ${node.status === 'PAUSED' ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button class="action-btn cancel-btn" onclick="triggerNodeAction('${node.node_id}', 'cancel')">⏹ Cancel</button>`;
        }
        actionsContainer.innerHTML = actionsHtml;
      }
    }
  });
}

// Helper: build the full inner HTML for a new printer card (used only on first creation)
function _buildPrinterCardInner(node, statusClass, isEjecting, isWaitingEject, isIdle, isPrintActive, job) {
  return `
    <div class="printer-card-header">
      <div class="node-identity">
        <span class="node-name">${node.name}</span>
      </div>
      <span class="status-badge ${statusClass}">${node.status}</span>
    </div>

    ${isEjecting ? `
      <div class="swapper-banner">
        <span>EJECTING PLATE... SWAPPER MECHANISM ACTIVE</span>
        <strong data-role="eject-countdown">${node.eject_countdown_s}s</strong>
      </div>
    ` : ""}

    ${isWaitingEject ? `
      <div class="swapper-banner waiting-banner">
        <span>WAITING FOR EJECTOR (QUEUED IN LINE)</span>
        <strong>WAITING...</strong>
      </div>
    ` : ""}

    <!-- Telemetry Gauges -->
    <div class="telemetry-row">
      <div class="temp-box">
        <div class="temp-header">
          <span>HOTEND TEMP</span>
          <span>T: ${node.target_hotend_temp}°C</span>
        </div>
        <div class="temp-readout hotend-color">${node.current_hotend_temp}°C</div>
      </div>
      <div class="temp-box">
        <div class="temp-header">
          <span>BED TEMP</span>
          <span>T: ${node.target_bed_temp}°C</span>
        </div>
        <div class="temp-readout bed-color">${node.current_bed_temp}°C</div>
      </div>
    </div>

    <!-- Print Progress -->
    <div class="job-progress-container">
      <div class="job-info-row">
        <span class="job-filename">${job ? job.filename : "No active job"}</span>
        <span class="layer-counter">${node.status === 'PRINTING' ? `Layer ${node.current_layer} / ${node.total_layers}` : "--"}</span>
      </div>

      <div class="progress-track">
        <div class="progress-fill" style="width: ${node.progress}%"></div>
      </div>

      <div class="job-meta-footer">
        <span>PROGRESS: <strong>${node.progress}%</strong></span>
        <span>FAN: ${node.fan_rpm} RPM</span>
        <span>RATE: ${node.extruding_rate} mm³/s</span>
      </div>
    </div>

    <!-- Manual Actions -->
    <div class="card-actions" data-state="${isIdle ? 'idle' : isPrintActive ? `active-${node.status}` : 'none'}">
      ${isIdle ? `<button class="action-btn eject-btn" onclick="triggerNodeAction('${node.node_id}', 'force_eject')">Eject plate</button>` : ""}
      ${isPrintActive ? `
        <button class="action-btn" onclick="triggerNodeAction('${node.node_id}', '${node.status === 'PAUSED' ? 'resume' : 'pause'}')">
          ${node.status === 'PAUSED' ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button class="action-btn cancel-btn" onclick="triggerNodeAction('${node.node_id}', 'cancel')">⏹ Cancel</button>
      ` : ""}
    </div>
  `;
}

// Render Consumables & Spool Tracking
// Uses in-place DOM updates to prevent hover-state flicker.
function renderConsumables(nodes) {
  const container = document.getElementById("consumables-list");
  if (!container) return;

  const nodeKeys = Object.keys(nodes).sort();
  const expectedIds = new Set(nodeKeys.map((id) => `consumable-${id}`));

  // Remove stale consumable items
  Array.from(container.children).forEach((child) => {
    if (!expectedIds.has(child.id)) child.remove();
  });

  nodeKeys.forEach((nodeId) => {
    const node = nodes[nodeId];
    const spool = node.spool || {};
    const itemId = `consumable-${nodeId}`;
    let item = document.getElementById(itemId);

    if (!item) {
      item = document.createElement("div");
      item.className = "consumable-item";
      item.id = itemId;
      item.innerHTML = `
        <div class="consumable-header">
          <span class="spool-name">
            <span class="spool-dot" style="background-color: ${spool.color}"></span>
            ${node.name}
          </span>
          <span class="spool-val">${spool.remaining_g}g / ${spool.capacity_g}g (${spool.pct}%)</span>
        </div>
        <div class="spool-bar-track">
          <div class="spool-bar-fill" style="width: ${spool.pct}%; background-color: ${spool.color}"></div>
        </div>
        <div class="job-meta-footer" style="margin-top: 0.3rem;">
          <span>SPOOL: <strong style="color: ${spool.color}">${spool.type}</strong></span>
          <a href="#" style="color: var(--accent-cyan); text-decoration: none; font-weight: 600;" onclick="openRestockModal('${node.node_id}'); return false;">+ Restock Spool</a>
        </div>
      `;
      container.appendChild(item);
      return;
    }

    // In-place updates
    const spoolVal = item.querySelector(".spool-val");
    if (spoolVal) spoolVal.textContent = `${spool.remaining_g}g / ${spool.capacity_g}g (${spool.pct}%)`;

    const barFill = item.querySelector(".spool-bar-fill");
    if (barFill) {
      barFill.style.width = `${spool.pct}%`;
      barFill.style.backgroundColor = spool.color;
    }

    const spoolDot = item.querySelector(".spool-dot");
    if (spoolDot) spoolDot.style.backgroundColor = spool.color;

    const spoolTypeStrong = item.querySelector(".job-meta-footer strong");
    if (spoolTypeStrong) {
      spoolTypeStrong.textContent = spool.type;
      spoolTypeStrong.style.color = spool.color;
    }
  });
}

// Render Global Queue
// Uses in-place DOM updates to prevent hover-state flicker.
function renderQueue(queue) {
  const container = document.getElementById("queue-list");
  const countBadge = document.getElementById("queue-count-badge");
  if (!container) return;

  if (countBadge) countBadge.textContent = `${queue.length} Pending`;

  if (queue.length === 0) {
    if (!container.querySelector(".empty-queue-msg")) {
      container.innerHTML = `<div class="empty-queue-msg">Queue empty. Drop CAD files above to populate.</div>`;
    }
    return;
  }

  // Remove empty-queue message if present
  const emptyMsg = container.querySelector(".empty-queue-msg");
  if (emptyMsg) emptyMsg.remove();

  // Build set of expected queue item IDs
  const expectedIds = new Set(queue.map((job) => `queue-${job.job_id}`));

  // Remove stale queue items
  Array.from(container.children).forEach((child) => {
    if (!expectedIds.has(child.id)) child.remove();
  });

  queue.forEach((job) => {
    const itemId = `queue-${job.job_id}`;
    let item = document.getElementById(itemId);

    if (!item) {
      item = document.createElement("div");
      item.className = "queue-item";
      item.id = itemId;
      item.innerHTML = `
        <div class="queue-item-info">
          <span class="queue-filename">${job.filename}</span>
          <span class="queue-meta">
            ${job.file_type} • ${job.mass_g}g • ${job.total_layers} layers • ${job.auto_routed_node || 'Auto-Routed'}
          </span>
        </div>
        <button class="queue-cancel-btn" onclick="cancelQueueJob('${job.job_id}')" title="Cancel Job">✕</button>
      `;
      container.appendChild(item);
      return;
    }

    // In-place updates for queue metadata
    const metaSpan = item.querySelector(".queue-meta");
    if (metaSpan) {
      metaSpan.textContent = `${job.file_type} • ${job.mass_g}g • ${job.total_layers} layers • ${job.auto_routed_node || 'Auto-Routed'}`;
    }
  });
}

// --------------------------------------------------------------------------
// Restock Filament Spool Specification Modal Logic
// --------------------------------------------------------------------------
function openRestockModal(nodeId) {
  const modal = document.getElementById("restock-modal");
  const hiddenId = document.getElementById("restock-node-id");
  if (!modal || !hiddenId) return;

  hiddenId.value = nodeId;

  let currentNode = null;
  if (isDemoSimulatorMode && demoState.nodes[nodeId]) {
    currentNode = demoState.nodes[nodeId];
  } else if (currentTelemetry && currentTelemetry.nodes && currentTelemetry.nodes[nodeId]) {
    currentNode = currentTelemetry.nodes[nodeId];
  }

  if (currentNode && currentNode.spool) {
    const spool = currentNode.spool;
    if (spool.color) document.getElementById("spool-color").value = spool.color;
    if (spool.capacity_g) document.getElementById("spool-weight").value = spool.capacity_g;
  } else {
    document.getElementById("spool-weight").value = 1000;
  }

  modal.classList.remove("hidden");
}

function closeRestockModal() {
  const modal = document.getElementById("restock-modal");
  if (modal) modal.classList.add("hidden");
}

function setRestockColor(hex) {
  const colorInput = document.getElementById("spool-color");
  if (colorInput) colorInput.value = hex;
}

async function handleRestockSubmit(event) {
  event.preventDefault();
  const nodeId = document.getElementById("restock-node-id").value;
  const brand = document.getElementById("spool-brand").value;
  const material = document.getElementById("spool-material").value;
  const color = document.getElementById("spool-color").value;
  const weight = parseFloat(document.getElementById("spool-weight").value) || 1000.0;

  if (isDemoSimulatorMode) {
    const node = demoState.nodes[nodeId];
    if (node) {
      node.spool = {
        remaining_g: weight,
        capacity_g: weight,
        pct: 100.0,
        type: `${brand} ${material}`,
        color: color
      };
      renderTelemetry(getDemoTelemetrySnapshot());
    }
  } else {
    try {
      const formData = new FormData();
      formData.append("action", "restock_spool");
      formData.append("brand", brand);
      formData.append("material", material);
      formData.append("color", color);
      formData.append("weight", weight.toString());

      await fetch(`/api/printers/${nodeId}/action`, {
        method: "POST",
        body: formData
      });
    } catch (err) {
      console.error("Restock spool API call failed:", err);
    }
  }

  closeRestockModal();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeRestockModal();
});

// --------------------------------------------------------------------------
// Drag & Drop Handler & Automation Pipeline
// --------------------------------------------------------------------------
function initDragAndDrop() {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");

  if (!dropZone || !fileInput) return;

  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleCADFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleCADFileUpload(e.target.files[0]);
    }
  });
}

function triggerPresetDrop(e, filename, sizeKb) {
  if (e && e.stopPropagation) {
    e.stopPropagation();
  }
  handleCADFileUpload({ name: filename, size: sizeKb * 1024 });
}

async function handleCADFileUpload(file) {
  const overlay = document.getElementById("pipeline-overlay");
  if (overlay) overlay.classList.remove("hidden");

  setStepActive(1);
  await sleep(500);

  setStepActive(2);
  await sleep(600);

  setStepActive(3);
  await sleep(500);

  setStepActive(4);

  if (isDemoSimulatorMode) {
    const gcodeFilename = file.name.includes(".") ? file.name.substring(0, file.name.lastIndexOf(".")) + ".gcode" : file.name + ".gcode";
    const specs = getDeterministicCadSpecs(file.name);
    const newJob = {
      job_id: `JOB-${Math.floor(Math.random() * 9000 + 1000)}`,
      filename: gcodeFilename,
      file_type: "GCODE",
      mass_g: specs.mass_g,
      total_layers: specs.total_layers,
      estimated_duration_s: specs.estimated_duration_s,
      target_hotend: 225.0,
      target_bed: 60.0,
      priority: "HIGH (AUTO)",
      created_at: new Date().toLocaleTimeString(),
      auto_routed_node: "Node 3"
    };
    demoState.queue.push(newJob);
    demoState.total_cad_dispatched += 1;
    tickDemoSimulator(0.1);
    renderTelemetry(getDemoTelemetrySnapshot());
  } else {
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);

      const res = await fetch("/api/upload-cad", {
        method: "POST",
        body: formData
      });
      const result = await res.json();
      console.log("CAD Upload Success:", result);
    } catch (err) {
      console.error("Upload error, using WebSocket fallback:", err);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          action: "zero_touch_drop",
          filename: file.name,
          file_size_kb: Math.round(file.size / 1024)
        }));
      }
    }
  }

  await sleep(400);
  if (overlay) overlay.classList.add("hidden");
  resetSteps();
}

function setStepActive(stepNum) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step-${i}`);
    if (!el) continue;
    if (i < stepNum) {
      el.className = "step-item completed";
    } else if (i === stepNum) {
      el.className = "step-item active";
    } else {
      el.className = "step-item";
    }
  }
}

function resetSteps() {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step-${i}`);
    if (el) el.className = i === 1 ? "step-item active" : "step-item";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Node & Queue Actions API Calls / Demo Handler
async function triggerNodeAction(nodeId, action) {
  if (isDemoSimulatorMode) {
    const node = demoState.nodes[nodeId];
    if (!node) return;

    if (action === "force_eject") {
      requestDemoEjection(nodeId);
    } else if (action === "pause") {
      if (node.status === "PRINTING" || node.status === "PREHEATING") {
        node.status = "PAUSED";
        node.extruding_rate = 0.0;
        node.fan_rpm = 1500;
      }
    } else if (action === "resume") {
      if (node.status === "PAUSED") {
        node.status = "PRINTING";
      }
    } else if (action === "cancel") {
      if (node.status === "PRINTING" || node.status === "PREHEATING" || node.status === "PAUSED" || node.current_job) {
        requestDemoEjection(nodeId);
      } else if (node.status !== "EJECTING" && node.status !== "WAITING FOR EJECT") {
        node.status = "IDLE";
        node.current_job = null;
        node.progress = 0.0;
      }
    } else if (action === "restock_spool") {
      node.spool.remaining_g = 1000.0;
      node.spool.pct = 100.0;
    }
    renderTelemetry(getDemoTelemetrySnapshot());
    return;
  }

  try {
    const formData = new FormData();
    formData.append("action", action);

    await fetch(`/api/printers/${nodeId}/action`, {
      method: "POST",
      body: formData
    });
  } catch (err) {
    console.error("Node action failed:", err);
  }
}

async function cancelQueueJob(jobId) {
  if (isDemoSimulatorMode) {
    demoState.queue = demoState.queue.filter(j => j.job_id !== jobId);
    renderTelemetry(getDemoTelemetrySnapshot());
    return;
  }

  try {
    await fetch(`/api/queue/${jobId}`, {
      method: "DELETE"
    });
  } catch (err) {
    console.error("Queue cancel failed:", err);
  }
}
