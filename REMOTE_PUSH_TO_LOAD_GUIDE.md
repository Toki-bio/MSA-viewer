# Remote Push-to-Load Guide

This feature lets you press a key in Midnight Commander on a remote server and have the file automatically appear in MSA Viewer in your browser — no copy-paste needed.

## How It Works

```
MC on server  →  writes /tmp/.msa_viewer_queue
                        ↓
Browser polls  /api/ssh-poll-file  (every few seconds, or manual "Check Queue")
                        ↓
Server reads queue via plink/SSH, returns file path
                        ↓
Browser fetches file content via  /api/ssh-cat
                        ↓
MSA Viewer loads and renders alignment
```

## Requirements

- **Node.js** server running locally (`node server.js` or `start-server.bat`)
- **PuTTY / plink** installed and on `PATH` (Windows)
- Your SSH private key in PuTTY PPK format (`.ppk`)
- A configured `ssh-servers.json` (see below — file is gitignored)

---

## 1 — Configure ssh-servers.json

Copy `ssh-servers.example.json` → `ssh-servers.json` and fill in your real details:

```json
{
    "myserver": {
        "label":   "My Lab Server",
        "user":    "username",
        "host":    "server.example.com",
        "port":    22,
        "via":     null,
        "hostKey": "ssh-ed25519 255 SHA256:REPLACE_WITH_ACTUAL_FINGERPRINT"
    }
}
```

| Field     | Required | Notes |
|-----------|----------|-------|
| `label`   | yes      | Display name shown in the browser UI |
| `user`    | yes      | SSH username |
| `host`    | yes      | Hostname or IP |
| `port`    | yes      | SSH port (22 by default) |
| `via`     | yes      | Key of jump-host server, or `null` for direct |
| `hostKey` | **recommended** | Fingerprint for plink batch-mode (see below) |

### Why hostKey is important

plink runs in **batch mode** (`-batch`) so it cannot prompt interactively for host-key acceptance.  
If the key in PuTTY's Windows registry cache is missing or stale, plink fails silently and queue checks return empty.

**To get the fingerprint:**
```powershell
plink -batch -i C:\Users\you\.ssh\key.ppk -P 2222 user@host "whoami"
```
If the key is unknown/changed, plink prints something like:
```
The new ssh-ed25519 key fingerprint is:
  ssh-ed25519 255 SHA256:GUsE6lInfDHFGVOwluQ1Gq5bLnVvjs/v6qcozHTnVYs
```
Copy that line (starting with `ssh-ed25519 ...`) into your `ssh-servers.json` as the `hostKey` value.

> **Note**: `ssh-servers.json` is gitignored. It will never be committed.

---

## 2 — PPK Key Path

The PPK path is hardcoded near the top of `server.js`:

```js
const PPK = 'C:\\Users\\toki\\.ssh\\id_ed25519.ppk';
```

Change this to match your actual PPK file path if needed.

---

## 3 — Configure Midnight Commander Menu

On the remote server, add an entry to `~/.config/mc/menu` (or the system menu):

```
v   View in MSA viewer
    echo "%d/%f" > /tmp/.msa_viewer_queue
```

Then in MC: `F2 → v` queues the currently highlighted file.

Make the queue file writable by all users (so any login can write):
```bash
touch /tmp/.msa_viewer_queue
chmod 666 /tmp/.msa_viewer_queue
```

---

## 4 — Browser UI

1. Open `http://localhost:3000`
2. The **Input** section shows a row of server buttons (one per entry in `ssh-servers.json`)
3. Navigate to a file in MC and press `F2 → v`
4. In the browser:
   - The auto-poller checks every few seconds (pollable servers only — no `via` hop)
   - Or click **Check Queue** to check immediately

A mini-console appears in the bottom-right corner showing the fetch progress:
```
Checking toki-server…
Found: alignment.fas — fetching…
✓ alignment.fas · 127 seqs · toki-server
```
It closes automatically on success. On error it stays open and shows the error in red.

---

## 5 — Jump-Host (via) Configuration

If your target server is only reachable through a gateway:

```json
{
    "gateway": { "label": "Gateway",     "user": "gw",   "host": "gateway.example.com", "port": 22,   "via": null },
    "target":  { "label": "Lab Server",  "user": "lab",  "host": "10.0.0.5",            "port": 22,   "via": "gateway" }
}
```

- plink connects to `gateway`, then runs `ssh` inside to reach `target`
- Only servers without `via` (direct connections) are included in the auto-poller to avoid timeout buildup

---

## Troubleshooting

### "Queue check failed: FATAL ERROR: Cannot confirm a host key in batch mode"

plink cannot accept the host key non-interactively. Fix:
- Add the `hostKey` fingerprint to `ssh-servers.json` (see step 1)
- Or open PuTTY GUI once, connect to the server, and accept the key to add it to the registry

### "Queue check failed: HTTP 500"

The server returned a non-zero plink exit code. The real error is now shown in the mini-console and in the Node console log (`[POLL] serverKey failed: ...`). Common causes:
- Wrong PPK path in `server.js`  
- Wrong `host`/`port`/`user` in `ssh-servers.json`
- SSH tunnel down (check that port forwarding is active)

### "No file queued on server-name"

Queue file `/tmp/.msa_viewer_queue` on the remote server is empty. Either:
- MC menu entry was not triggered yet
- Queue was already consumed by a previous poll
- Path in MC menu entry is wrong (check `%d/%f` expansion)

### BLAST warning on startup

```
WARNING: BLAST is not installed or not in PATH
```
This is expected if BLAST+ is not installed. It does not affect SSH file loading — only the local BLAST search feature.
