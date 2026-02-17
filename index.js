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

function typeIcon(type) {
  const icons = {
    tool: '\u{1F527}', bash: '\u{1F4BB}', skill: '\u2B50',
    cron: '\u{1F552}', alert: '\u{1F514}', info: '\u2139\uFE0F',
  };
  return icons[(type || '').toLowerCase()] || '\u25CF';
}

function renderMarkdownBasic(md) {
  if (!md) return '';
  let html = escapeHtml(md);
  // Code blocks
  html = html.replace(/```[\s\S]*?```/g, (m) => {
    const inner = m.slice(3).replace(/^[^\n]*\n/, '').replace(/\n?```$/, '');
    return `<pre style="background:#0d1117;padding:8px;border-radius:4px;overflow-x:auto;">${inner}</pre>`;
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#0d1117;padding:2px 4px;border-radius:3px;">$1</code>');
  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 style="color:#e6edf3;margin:12px 0 4px;">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 style="color:#e6edf3;margin:14px 0 4px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="color:#e6edf3;margin:16px 0 6px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="color:#e6edf3;margin:18px 0 6px;">$1</h1>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li style="margin-left:16px;">$1</li>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ── API Routes ───────────────────────────────────────────────────────────────

// Health check
app.get('/healthz', (req, res) => {
  res.json({ ok: true, hasData: !!latestStatus, receivedAt });
});

// POST status from Marvin
app.post('/api/status', (req, res) => {
  // Optional bearer auth
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
  body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #e6edf3; display: flex; min-height: 100vh; }
  a { color: #58a6ff; text-decoration: none; }

  /* Sidebar */
  .sidebar { width: 280px; min-width: 280px; background: #161b22; border-right: 1px solid #30363d; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
  .sidebar .agent-header { text-align: center; padding-bottom: 16px; border-bottom: 1px solid #30363d; }
  .sidebar .agent-emoji { font-size: 48px; }
  .sidebar .agent-name { font-size: 20px; font-weight: 600; margin-top: 8px; }
  .sidebar .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 500; background: #21262d; margin-top: 8px; }
  .sidebar .section { font-size: 13px; color: #8b949e; }
  .sidebar .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #484f58; margin-bottom: 6px; }
  .sidebar .stat-row { display: flex; justify-content: space-between; padding: 3px 0; }
  .sidebar .stat-val { color: #e6edf3; font-weight: 500; }
  .sidebar .current-task { background: #1c2128; border: 1px solid #30363d; border-radius: 6px; padding: 10px; font-size: 13px; }
  .sidebar .mood-quip { font-style: italic; color: #8b949e; font-size: 13px; text-align: center; }
  .sidebar .heartbeat { font-size: 12px; color: #484f58; text-align: center; margin-top: auto; }

  /* Stale banner */
  .stale-banner { background: #f8514926; border: 1px solid #f85149; color: #f85149; padding: 8px 12px; border-radius: 6px; font-size: 13px; text-align: center; }

  /* Main content */
  .main { flex: 1; padding: 24px; overflow-y: auto; }

  /* Tabs */
  .tabs { display: flex; gap: 0; border-bottom: 1px solid #30363d; margin-bottom: 20px; }
  .tab { padding: 10px 20px; cursor: pointer; color: #8b949e; font-size: 14px; border-bottom: 2px solid transparent; transition: color 0.2s; }
  .tab:hover { color: #e6edf3; }
  .tab.active { color: #e6edf3; border-bottom-color: #f78166; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Cards */
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .card-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; color: #e6edf3; }

  /* Activity feed */
  .activity-item { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #21262d; }
  .activity-item:last-child { border-bottom: none; }
  .activity-icon { font-size: 18px; min-width: 28px; text-align: center; padding-top: 2px; }
  .activity-body { flex: 1; }
  .activity-summary { font-size: 14px; }
  .activity-detail { font-size: 12px; color: #8b949e; margin-top: 2px; font-family: 'SF Mono', 'Fira Code', monospace; }
  .activity-time { font-size: 12px; color: #484f58; white-space: nowrap; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; color: #8b949e; border-bottom: 1px solid #30363d; font-weight: 500; }
  td { padding: 8px 12px; border-bottom: 1px solid #21262d; }

  /* Progress bar */
  .progress-bar { background: #21262d; border-radius: 4px; height: 8px; overflow: hidden; margin-top: 4px; }
  .progress-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }

  /* Monitor grid */
  .monitor-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .monitor-item { display: flex; align-items: center; gap: 6px; background: #21262d; padding: 6px 12px; border-radius: 6px; font-size: 13px; }

  /* File tabs */
  .file-tabs { display: flex; gap: 0; margin-bottom: 12px; }
  .file-tab { padding: 6px 14px; cursor: pointer; color: #8b949e; font-size: 13px; background: #21262d; border: 1px solid #30363d; }
  .file-tab:first-child { border-radius: 6px 0 0 6px; }
  .file-tab:last-child { border-radius: 0 6px 6px 0; }
  .file-tab.active { color: #e6edf3; background: #30363d; }
  .file-panel { display: none; }
  .file-panel.active { display: block; }
  .file-content { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 16px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; line-height: 1.5; overflow-x: auto; margin-bottom: 12px; }
  .file-name { font-size: 13px; font-weight: 600; color: #f78166; margin-bottom: 8px; }

  /* Waiting state */
  .waiting { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; }
  .waiting .pulse { width: 16px; height: 16px; background: #58a6ff; border-radius: 50%; animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.3); } }
  .waiting p { margin-top: 16px; color: #8b949e; font-size: 15px; }

  /* Responsive */
  @media (max-width: 768px) {
    body { flex-direction: column; }
    .sidebar { width: 100%; min-width: unset; flex-direction: row; flex-wrap: wrap; padding: 12px; gap: 8px; border-right: none; border-bottom: 1px solid #30363d; }
    .sidebar .agent-header { flex: 1; min-width: 200px; text-align: left; display: flex; align-items: center; gap: 12px; border-bottom: none; padding-bottom: 0; }
    .sidebar .agent-emoji { font-size: 32px; }
    .sidebar .agent-name { margin-top: 0; }
    .sidebar .section { flex: 1; min-width: 140px; }
    .sidebar .heartbeat { margin-top: 0; width: 100%; }
    .main { padding: 16px; }
  }
</style>
</head>
<body>

${d ? renderSidebar(d, isStale) : ''}

<div class="main">
${d ? renderMainContent(d) : renderWaiting()}
</div>

<script>
// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const group = tab.dataset.group || 'main';
    document.querySelectorAll(\`.tab[data-group="\${group}"]\`).forEach(t => t.classList.remove('active'));
    document.querySelectorAll(\`.tab-content[data-group="\${group}"]\`).forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const target = document.getElementById(tab.dataset.tab);
    if (target) target.classList.add('active');
  });
});
// File sub-tab switching
document.querySelectorAll('.file-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.file-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.file-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const target = document.getElementById(tab.dataset.panel);
    if (target) target.classList.add('active');
  });
});
</script>

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

function renderSidebar(d, isStale) {
  const a = d.agent || {};
  const stats = a.todayStats || {};

  return `
<div class="sidebar">
  <div class="agent-header">
    <div class="agent-emoji">${escapeHtml(a.emoji) || '\u{1F916}'}</div>
    <div class="agent-name">${escapeHtml(a.name) || 'Marvin'}</div>
    <div class="status-badge">${statusDot(a.status)}${escapeHtml(a.status) || 'unknown'}</div>
  </div>

  ${isStale ? '<div class="stale-banner">\u26A0 Data is stale — last update ' + timeAgo(receivedAt) + '</div>' : ''}

  ${a.currentTask ? `
  <div class="current-task">
    <div class="section-title">Current Task</div>
    ${escapeHtml(a.currentTask)}
  </div>` : ''}

  ${a.moodQuip ? `<div class="mood-quip">"${escapeHtml(a.moodQuip)}"</div>` : ''}

  ${a.briefing ? `
  <div class="section">
    <div class="section-title">Briefing</div>
    ${escapeHtml(a.briefing)}
  </div>` : ''}

  <div class="section">
    <div class="section-title">Today's Stats</div>
    <div class="stat-row"><span>Tasks</span><span class="stat-val">${stats.tasksCompleted ?? '-'}</span></div>
    <div class="stat-row"><span>Alerts</span><span class="stat-val">${stats.alertsSent ?? '-'}</span></div>
    <div class="stat-row"><span>Cost</span><span class="stat-val">${escapeHtml(stats.costEstimate) || '-'}</span></div>
    ${a.mood ? `<div class="stat-row"><span>Mood</span><span class="stat-val">${escapeHtml(a.mood)}</span></div>` : ''}
  </div>

  <div class="heartbeat">Last heartbeat: ${timeAgo(a.lastHeartbeat || receivedAt)}</div>
</div>`;
}

function renderMainContent(d) {
  return `
  <div class="tabs">
    <div class="tab active" data-tab="tab-activity" data-group="main">Activity Feed</div>
    <div class="tab" data-tab="tab-system" data-group="main">System Status</div>
    <div class="tab" data-tab="tab-files" data-group="main">Files</div>
  </div>

  <div id="tab-activity" class="tab-content active" data-group="main">
    ${renderActivityFeed(d.actions)}
  </div>

  <div id="tab-system" class="tab-content" data-group="main">
    ${renderSystemStatus(d)}
  </div>

  <div id="tab-files" class="tab-content" data-group="main">
    ${renderFilesTab(d)}
  </div>`;
}

function renderActivityFeed(actions) {
  if (!actions || !actions.length) {
    return '<div class="card"><p style="color:#8b949e;">No activity recorded yet.</p></div>';
  }
  const items = actions.map(a => `
    <div class="activity-item">
      <div class="activity-icon">${typeIcon(a.type)}</div>
      <div class="activity-body">
        <div class="activity-summary">${escapeHtml(a.summary)}</div>
        ${a.detail ? `<div class="activity-detail">${escapeHtml(a.detail)}</div>` : ''}
      </div>
      <div class="activity-time">${timeAgo(a.time)}</div>
    </div>`).join('');

  return `<div class="card"><div class="card-title">Activity</div>${items}</div>`;
}

function renderSystemStatus(d) {
  let html = '';

  // Proxmox
  if (d.proxmox) {
    const px = d.proxmox;
    if (px.containers && px.containers.length) {
      html += `<div class="card"><div class="card-title">Proxmox Containers</div>
        <table><thead><tr><th>VMID</th><th>Name</th><th>Status</th></tr></thead><tbody>
        ${px.containers.map(c => `<tr><td>${escapeHtml(String(c.vmid))}</td><td>${escapeHtml(c.name)}</td><td>${statusDot(c.status)}${escapeHtml(c.status)}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
    if (px.host) {
      const h = px.host;
      const memPct = h.memPercent ? parseInt(h.memPercent) : (h.memTotal ? Math.round(h.memUsed / h.memTotal * 100) : 0);
      const diskPct = h.diskPercent ? parseInt(h.diskPercent) : 0;
      html += `<div class="card"><div class="card-title">Host Resources</div>
        <div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;"><span>Memory</span><span>${h.memUsed ? Math.round(h.memUsed / 1024) + 'G' : '?'} / ${h.memTotal ? Math.round(h.memTotal / 1024) + 'G' : '?'} (${memPct}%)</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${memPct}%;background:${memPct > 90 ? '#f85149' : memPct > 70 ? '#d29922' : '#3fb950'};"></div></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px;"><span>Disk</span><span>${escapeHtml(h.diskUsed || '?')} / ${escapeHtml(h.diskTotal || '?')} (${escapeHtml(h.diskPercent || '?')})</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${diskPct}%;background:${diskPct > 90 ? '#f85149' : diskPct > 70 ? '#d29922' : '#3fb950'};"></div></div>
        </div>
      </div>`;
    }
  }

  // Docker
  if (d.docker && d.docker.length) {
    html += `<div class="card"><div class="card-title">Docker Containers</div>
      <table><thead><tr><th>Name</th><th>Image</th><th>Status</th></tr></thead><tbody>
      ${d.docker.map(c => `<tr><td>${escapeHtml(c.name)}</td><td style="color:#8b949e;">${escapeHtml(c.image)}</td><td>${escapeHtml(c.status)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // Coolify
  if (d.coolify && d.coolify.length) {
    html += `<div class="card"><div class="card-title">Coolify Apps</div>
      <table><thead><tr><th>Name</th><th>Status</th><th>URL</th></tr></thead><tbody>
      ${d.coolify.map(c => `<tr><td>${escapeHtml(c.name)}</td><td>${statusDot(c.status)}${escapeHtml(c.status)}</td><td style="color:#8b949e;">${escapeHtml(c.fqdn || '')}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // Monitors
  if (d.monitors && d.monitors.length) {
    html += `<div class="card"><div class="card-title">Uptime Monitors</div>
      <div class="monitor-grid">
      ${d.monitors.map(m => `<div class="monitor-item">${statusDot(m.status)}${escapeHtml(m.name)}</div>`).join('')}
      </div></div>`;
  }

  // Git
  if (d.git && d.git.recentActivity && d.git.recentActivity.length) {
    html += `<div class="card"><div class="card-title">Recent Git Activity</div>
      ${d.git.recentActivity.map(g => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #21262d;font-size:13px;">
          <span><strong>${escapeHtml(g.repo)}</strong> — ${escapeHtml(g.event)}</span>
          <span style="color:#484f58;">${timeAgo(g.time)}</span>
        </div>`).join('')}
    </div>`;
  }

  return html || '<div class="card"><p style="color:#8b949e;">No system data available.</p></div>';
}

function renderFilesTab(d) {
  const files = d.files || {};
  const hasPersonality = files.personality && Object.keys(files.personality).length;
  const hasMemory = files.memory && Object.keys(files.memory).length;
  const hasConfig = files.config && Object.keys(files.config).length;
  const hasAny = hasPersonality || hasMemory || hasConfig;

  if (!hasAny && (!d.recentFiles || !d.recentFiles.length)) {
    return '<div class="card"><p style="color:#8b949e;">No file data available.</p></div>';
  }

  let html = '';

  if (hasAny) {
    html += `<div class="file-tabs">
      ${hasPersonality ? '<div class="file-tab active" data-panel="fp-personality">Personality</div>' : ''}
      ${hasMemory ? `<div class="file-tab${!hasPersonality ? ' active' : ''}" data-panel="fp-memory">Memory</div>` : ''}
      ${hasConfig ? `<div class="file-tab${!hasPersonality && !hasMemory ? ' active' : ''}" data-panel="fp-config">Config</div>` : ''}
    </div>`;

    if (hasPersonality) {
      html += `<div id="fp-personality" class="file-panel active">
        ${renderFileGroup(files.personality)}
      </div>`;
    }
    if (hasMemory) {
      html += `<div id="fp-memory" class="file-panel${!hasPersonality ? ' active' : ''}">
        ${renderFileGroup(files.memory)}
      </div>`;
    }
    if (hasConfig) {
      html += `<div id="fp-config" class="file-panel${!hasPersonality && !hasMemory ? ' active' : ''}">
        ${renderFileGroup(files.config)}
      </div>`;
    }
  }

  if (d.recentFiles && d.recentFiles.length) {
    html += `<div class="card" style="margin-top:16px;"><div class="card-title">Recently Touched Files</div>
      <table><thead><tr><th>Path</th><th>Op</th><th>Time</th></tr></thead><tbody>
      ${d.recentFiles.map(f => `<tr><td style="font-family:monospace;font-size:12px;">${escapeHtml(f.path)}</td><td>${escapeHtml(f.op)}</td><td style="color:#484f58;">${timeAgo(f.time)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  return html;
}

function renderFileGroup(group) {
  return Object.entries(group).map(([name, content]) => `
    <div style="margin-bottom:16px;">
      <div class="file-name">${escapeHtml(name)}</div>
      <div class="file-content">${renderMarkdownBasic(content)}</div>
    </div>`).join('');
}

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Marvin Status Dashboard running on port ${PORT}`);
  if (AUTH_TOKEN) console.log('POST auth enabled');
  if (RELAY_URL) console.log(`Relay forwarding to ${RELAY_URL}`);
});
