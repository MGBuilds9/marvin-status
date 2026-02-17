# Marvin Status Dashboard

Live dashboard for Marvin's agent status, activity log, system health, and personality/memory files.

## Architecture

**Push model** — Marvin collects data during heartbeats and POSTs it to this app. The app stores the latest payload in memory and serves an HTML dashboard.

```
Marvin (CT 110, .41) ---POST /api/status---> marvin-status (Coolify .31:3005)
                                                    |
Browser ----------------GET /---------------> HTML dashboard
```

## API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/status` | Bearer token (optional) | Marvin pushes status data |
| `GET` | `/` | None | HTML dashboard |
| `GET` | `/api/status` | None | Raw JSON of latest push |
| `GET` | `/healthz` | None | Health check |

## POST Payload

Marvin sends a JSON object with these optional sections:

- `agent` — name, status, emoji, briefing, currentTask, mood, todayStats
- `actions` — array of `{ time, type, summary, detail }` entries
- `files` — `{ personality: {}, memory: {}, config: {} }` with full file contents
- `recentFiles` — array of `{ path, op, time }` entries
- `proxmox` — containers list + host resource usage
- `docker` — container list with status
- `coolify` — app list with status/fqdn
- `monitors` — uptime monitor status
- `git` — recent activity across repos
- `timestamp` — ISO timestamp of the push

## Environment Variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | Server port |
| `STATUS_AUTH_TOKEN` | (none) | Bearer token for POST auth |
| `RELAY_URL` | (none) | Forward `agent` sub-object to relay |
| `RELAY_AGENT_SECRET` | (none) | Bearer token for relay |

## Deploy on Coolify

1. Add Resource > Public Repo > `https://github.com/MGBuilds9/marvin-status`
2. Build Pack: Dockerfile
3. Set env vars: `STATUS_AUTH_TOKEN`
4. Port: 3000

## Local Dev

```bash
npm install
node index.js
# POST test data:
curl -X POST http://localhost:3000/api/status \
  -H "Content-Type: application/json" \
  -d '{"agent":{"name":"Marvin","status":"online","emoji":"🤖"},"timestamp":"2026-02-16T22:30:00Z"}'
# Open http://localhost:3000
```
