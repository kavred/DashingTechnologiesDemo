/**
 * DASING LABS // AUTOPRINT OS FRONTEND ENGINE
 * WebSocket Telemetry Manager & Zero-Touch CAD Dispatch System
 */

let ws = null;
let reconnectTimer = null;
let currentTelemetry = null;

// Initialize App on DOM Loaded
document.addEventListener("DOMContentLoaded", () => {
  initWebSocket();
  initDragAndDrop();
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

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
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
    console.error("WebSocket Error:", err);
  };

  ws.onclose = () => {
    statusText.textContent = "DISCONNECTED - RETRYING";
    indicator.style.backgroundColor = "#ef4444";
    if (!reconnectTimer) {
      reconnectTimer = setInterval(initWebSocket, 3000);
    }
  };
}

// --------------------------------------------------------------------------
// Render Telemetry Dashboard
// --------------------------------------------------------------------------
function renderTelemetry(data) {
  if (!data) return;

  const fleet = data.fleet_summary || {};
  const nodes = data.nodes || {};
  const queue = data.queue || [];

  document.getElementById("stat-active-nodes").textContent = `${fleet.active_nodes} / ${fleet.total_nodes} ACTIVE`;
  document.getElementById("stat-plates-ejected").textContent = fleet.total_plates_ejected || 0;
  document.getElementById("stat-cad-dispatched").textContent = fleet.total_cad_dispatched || 0;
  document.getElementById("stat-health-score").textContent = `${fleet.farm_health_score || 98.4}%`;

  renderPrinterGrid(nodes);
  renderConsumables(nodes);
  renderQueue(queue);
}

// Render Printer Nodes (Node 1, Node 2, Node 3, Node 4)
function renderPrinterGrid(nodes) {
  const gridContainer = document.getElementById("printer-grid");
  if (!gridContainer) return;

  const nodeKeys = Object.keys(nodes).sort();
  let html = "";

  nodeKeys.forEach((nodeId) => {
    const node = nodes[nodeId];
    const statusClass = node.status.toLowerCase().replace(/\s+/g, '-');
    const isEjecting = node.status === "EJECTING";
    const isWaitingEject = node.status === "WAITING FOR EJECT";
    const job = node.current_job;

    html += `
      <div class="printer-card" id="card-${node.node_id}">
        <div class="printer-card-header">
          <div class="node-identity">
            <span class="node-name">${node.name}</span>
          </div>
          <span class="status-badge ${statusClass}">${node.status}</span>
        </div>

        ${isEjecting ? `
          <div class="swapper-banner">
            <span>EJECTING PLATE... SWAPPER MECHANISM ACTIVE</span>
            <strong>${node.eject_countdown_s}s</strong>
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
        <div class="card-actions">
          <button class="action-btn eject-btn" onclick="triggerNodeAction('${node.node_id}', 'force_eject')">Eject plate</button>
          <button class="action-btn" onclick="triggerNodeAction('${node.node_id}', '${node.status === 'PAUSED' ? 'resume' : 'pause'}')">
            ${node.status === 'PAUSED' ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button class="action-btn" onclick="triggerNodeAction('${node.node_id}', 'cancel')">⏹ Cancel</button>
        </div>
      </div>
    `;
  });

  gridContainer.innerHTML = html;
}

// Render Consumables & Spool Tracking
function renderConsumables(nodes) {
  const container = document.getElementById("consumables-list");
  if (!container) return;

  let html = "";
  Object.keys(nodes).sort().forEach((nodeId) => {
    const node = nodes[nodeId];
    const spool = node.spool || {};

    html += `
      <div class="consumable-item">
        <div class="consumable-header">
          <span class="spool-name">
            <span class="spool-dot" style="background-color: ${spool.color}"></span>
            ${node.name} (${spool.type})
          </span>
          <span class="spool-val">${spool.remaining_g}g / ${spool.capacity_g}g (${spool.pct}%)</span>
        </div>
        <div class="spool-bar-track">
          <div class="spool-bar-fill" style="width: ${spool.pct}%; background-color: ${spool.color}"></div>
        </div>
        <div class="job-meta-footer" style="margin-top: 0.3rem;">
          <span>SPOOL MATERIAL: <strong style="color: ${spool.color}">${spool.type}</strong></span>
          <a href="#" style="color: var(--accent-cyan); text-decoration: none; font-weight: 600;" onclick="triggerNodeAction('${node.node_id}', 'restock_spool'); return false;">+ Restock Spool</a>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Render Global Queue
function renderQueue(queue) {
  const container = document.getElementById("queue-list");
  const countBadge = document.getElementById("queue-count-badge");
  if (!container) return;

  countBadge.textContent = `${queue.length} Pending`;

  if (queue.length === 0) {
    container.innerHTML = `<div class="empty-queue-msg">Queue empty. Drop CAD files above to populate.</div>`;
    return;
  }

  let html = "";
  queue.forEach((job) => {
    html += `
      <div class="queue-item">
        <div class="queue-item-info">
          <span class="queue-filename">${job.filename}</span>
          <span class="queue-meta">
            ${job.file_type} • ${job.mass_g}g • ${job.total_layers} layers • ${job.auto_routed_node}
          </span>
        </div>
        <button class="queue-cancel-btn" onclick="cancelQueueJob('${job.job_id}')" title="Cancel Job">✕</button>
      </div>
    `;
  });

  container.innerHTML = html;
}

// --------------------------------------------------------------------------
// Drag & Drop Handler & Automation Pipeline
// --------------------------------------------------------------------------
function initDragAndDrop() {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");

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
  overlay.classList.remove("hidden");

  setStepActive(1);
  await sleep(500);

  setStepActive(2);
  await sleep(600);

  setStepActive(3);
  await sleep(500);

  setStepActive(4);
  
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

  await sleep(400);
  overlay.classList.add("hidden");
  resetSteps();
}

function setStepActive(stepNum) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step-${i}`);
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
    el.className = i === 1 ? "step-item active" : "step-item";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Node & Queue Actions API Calls
async function triggerNodeAction(nodeId, action) {
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
  try {
    await fetch(`/api/queue/${jobId}`, {
      method: "DELETE"
    });
  } catch (err) {
    console.error("Queue cancel failed:", err);
  }
}
