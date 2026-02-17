const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Optional auth for POST
const AUTH_TOKEN = process.env.STATUS_AUTH_TOKEN || '';
// Optional relay forwarding
const RELAY_URL = process.env.RELAY_URL || '';
const RELAY_AGENT_SECRET = process.env.RELAY_AGENT_SECRET || '';

// In-memory store
let latestStatus = null;
let receivedAt = null;

app.use(express.json({ limit: '512kb' }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function statusColor(status) {
  const map = {
    online: '#3fb950', running: '#3fb950', up: '#3fb950',
    idle: '#d29922', sleeping: '#d29922',
    working: '#58a6ff',
    error: '#f85149', down: '#f85149', stopped: '#f85149', offline: '#f85149',
  };
  return map[(status || '').toLowerCase()] || '#8b949e';
}

function statusDot(status) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${statusColor(status)};margin-right:6px;vertical-align:middle;"></span>`;
}

// ── API Routes ───────────────────────────────────────────────────────────────

// Health check
app.get('/healthz', (req, res) => {
  res.json({ ok: true, hasData: !!latestStatus, receivedAt });
});

// POST status from Marvin
app.post('/api/status', (req, res) => {
  if (AUTH_TOKEN) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${AUTH_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  latestStatus = req.body;
  receivedAt = new Date().toISOString();
  console.log(`[${receivedAt}] Status received from ${latestStatus?.agent?.name || 'unknown'}`);

  // Optional relay forwarding
  if (RELAY_URL && latestStatus?.agent) {
    forwardToRelay(latestStatus.agent).catch(e =>
      console.error('Relay forward failed:', e.message)
    );
  }

  res.json({ ok: true, receivedAt });
});

// GET raw JSON
app.get('/api/status', (req, res) => {
  if (!latestStatus) return res.json({ status: 'waiting', message: 'No data received yet' });
  res.json({ ...latestStatus, _receivedAt: receivedAt });
});

// Dashboard HTML
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderDashboard());
});

// ── Relay Forwarding ─────────────────────────────────────────────────────────

async function forwardToRelay(agentData) {
  const resp = await fetch(`${RELAY_URL}/api/agent-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(RELAY_AGENT_SECRET ? { 'Authorization': `Bearer ${RELAY_AGENT_SECRET}` } : {}),
    },
    body: JSON.stringify(agentData),
  });
  if (!resp.ok) console.error(`Relay responded ${resp.status}`);
}

// ── HTML Renderer ────────────────────────────────────────────────────────────

function renderDashboard() {
  const d = latestStatus;
  const staleMs = receivedAt ? Date.now() - new Date(receivedAt).getTime() : Infinity;
  const isStale = staleMs > 10 * 60 * 1000;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Marvin Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; padding: 24px; }

  .container { max-width: 900px; margin: 0 auto; }

  /* Header */
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #30363d; }
  .header-name { font-size: 24px; font-weight: 600; }
  .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 14px; border-radius: 12px; font-size: 14px; font-weight: 500; background: #21262d; }
  .heartbeat-time { font-size: 13px; color: #8b949e; margin-left: auto; }

  /* Stale banner */
  .stale-banner { background: #f8514926; border: 1px solid #f85149; color: #f85149; padding: 10px 14px; border-radius: 6px; font-size: 13px; text-align: center; margin-bottom: 16px; }

  /* Briefing */
  .briefing { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; font-size: 15px; }

  /* Current task */
  .current-task { background: #1c2128; border: 1px solid #30363d; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; font-size: 14px; }
  .current-task .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #58a6ff; margin-bottom: 4px; }

  /* Cards */
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .card-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Health grid */
  .health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }

  /* Dot grid for containers/apps */
  .dot-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .dot-item { display: flex; align-items: center; gap: 6px; background: #21262d; padding: 5px 10px; border-radius: 6px; font-size: 13px; }

  /* Progress bar */
  .resource-row { margin-bottom: 10px; }
  .resource-row:last-child { margin-bottom: 0; }
  .resource-label { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
  .resource-label .val { color: #8b949e; }
  .progress-bar { background: #21262d; border-radius: 4px; height: 8px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 4px; }

  /* Waiting state */
  .waiting { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; }
  .waiting .pulse { width: 16px; height: 16px; background: #58a6ff; border-radius: 50%; animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.3); } }
  .waiting p { margin-top: 16px; color: #8b949e; font-size: 15px; }

  @media (max-width: 600px) {
    body { padding: 12px; }
    .header { flex-wrap: wrap; }
    .heartbeat-time { margin-left: 0; width: 100%; margin-top: 4px; }
    .health-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>

<div class="container">
${d ? renderContent(d, isStale) : renderWaiting()}
</div>

</body>
</html>`;
}

function renderWaiting() {
  return `
  <div class="waiting">
    <div class="pulse"></div>
    <p>Waiting for first heartbeat...</p>
  </div>`;
}

function renderContent(d, isStale) {
  const a = d.agent || {};

  let html = '';

  // Header: name + status + last heartbeat
  html += `
  <div class="header">
    <div class="header-name">\u{1F916} ${escapeHtml(a.name) || 'Marvin'}</div>
    <div class="status-badge">${statusDot(a.status)}${escapeHtml(a.status) || 'unknown'}</div>
    <div class="heartbeat-time">Last heartbeat: ${timeAgo(a.lastHeartbeat || receivedAt)}</div>
  </div>`;

  // Stale warning
  if (isStale) {
    html += `<div class="stale-banner">\u26A0 Stale — last update ${timeAgo(receivedAt)}</div>`;
  }

  // Briefing
  if (a.briefing) {
    html += `<div class="briefing">${escapeHtml(a.briefing)}</div>`;
  }

  // Current task
  if (a.currentTask) {
    html += `
    <div class="current-task">
      <div class="label">Current Task</div>
      ${escapeHtml(a.currentTask)}
    </div>`;
  }

  // System health grid
  html += `<div class="health-grid">`;

  // Proxmox containers
  if (d.proxmox && d.proxmox.containers && d.proxmox.containers.length) {
    html += `
    <div class="card">
      <div class="card-title">Proxmox (${d.proxmox.containers.length} CTs)</div>
      <div class="dot-grid">
        ${d.proxmox.containers.map(c =>
          `<div class="dot-item">${statusDot(c.status)}${escapeHtml(c.name)}</div>`
        ).join('')}
      </div>
    </div>`;
  }

  // Docker containers
  if (d.docker && d.docker.length) {
    html += `
    <div class="card">
      <div class="card-title">Docker (${d.docker.length} containers)</div>
      <div class="dot-grid">
        ${d.docker.map(c => {
          const isUp = (c.status || '').toLowerCase().includes('up');
          return `<div class="dot-item">${statusDot(isUp ? 'running' : 'down')}${escapeHtml(c.name)}</div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // Coolify apps
  if (d.coolify && d.coolify.length) {
    html += `
    <div class="card">
      <div class="card-title">Coolify (${d.coolify.length} apps)</div>
      <div class="dot-grid">
        ${d.coolify.map(c =>
          `<div class="dot-item">${statusDot(c.status)}${escapeHtml(c.name)}</div>`
        ).join('')}
      </div>
    </div>`;
  }

  // Host resources
  if (d.proxmox && d.proxmox.host) {
    const h = d.proxmox.host;
    const memPct = h.memPercent ? parseInt(h.memPercent) : (h.memTotal ? Math.round(h.memUsed / h.memTotal * 100) : 0);
    const diskPct = h.diskPercent ? parseInt(h.diskPercent) : 0;

    html += `
    <div class="card">
      <div class="card-title">Host Resources</div>
      <div class="resource-row">
        <div class="resource-label"><span>Memory</span><span class="val">${h.memUsed ? Math.round(h.memUsed / 1024) + 'G' : '?'} / ${h.memTotal ? Math.round(h.memTotal / 1024) + 'G' : '?'} (${memPct}%)</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${memPct}%;background:${memPct > 90 ? '#f85149' : memPct > 70 ? '#d29922' : '#3fb950'};"></div></div>
      </div>
      <div class="resource-row">
        <div class="resource-label"><span>Disk</span><span class="val">${escapeHtml(h.diskUsed || '?')} / ${escapeHtml(h.diskTotal || '?')} (${escapeHtml(h.diskPercent || '?')})</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${diskPct}%;background:${diskPct > 90 ? '#f85149' : diskPct > 70 ? '#d29922' : '#3fb950'};"></div></div>
      </div>
    </div>`;
  }

  // CT 110 (local) resources
  if (d.local) {
    const l = d.local;
    const localDiskPct = l.diskPercent ? parseInt(l.diskPercent) : 0;
    html += `
    <div class="card">
      <div class="card-title">CT 110 (Marvin)</div>
      <div class="resource-row">
        <div class="resource-label"><span>Load</span><span class="val">${escapeHtml(l.load || '?')}</span></div>
      </div>
      <div class="resource-row">
        <div class="resource-label"><span>Disk</span><span class="val">${escapeHtml(l.diskPercent || '?')}</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${localDiskPct}%;background:${localDiskPct > 90 ? '#f85149' : localDiskPct > 70 ? '#d29922' : '#3fb950'};"></div></div>
      </div>
      <div class="resource-row">
        <div class="resource-label"><span>Memory Available</span><span class="val">${l.memAvailMB || '?'} MB</span></div>
      </div>
      <div class="resource-row">
        <div class="resource-label"><span>Uptime</span><span class="val">${escapeHtml(l.uptime || '?')}</span></div>
      </div>
    </div>`;
  }

  html += `</div>`; // close health-grid

  return html;
}

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Marvin Status Dashboard running on port ${PORT}`);
  if (AUTH_TOKEN) console.log('POST auth enabled');
  if (RELAY_URL) console.log(`Relay forwarding to ${RELAY_URL}`);
});
