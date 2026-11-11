# Remote Push-to-Load Guide

This feature lets you press a key in Midnight Commander on a remote server, then click **Check Queue** in ViewAlign to load that file. No copy-paste is needed.

## How It Works

```
MC on server  →  writes /tmp/.msa_viewer_queue
                        ↓
You click "Check Queue"; browser calls  /api/ssh-poll-file  (it never polls by itself)
                        ↓
Server reads queue via plink/SSH, returns file path
                        ↓
Browser fetches file content via  /api/ssh-cat
                        ↓
ViewAlign loads and renders the alignment
```

## Requirements

- **Node.js** server running on your own machine (`node server.js` or `start-server.bat`); SSH loading works only for clients on that machine unless `ALLOW_REMOTE_FILE_ACCESS=1` is set
- **PuTTY / plink** installed and on `PATH`. The server runs `plink` for every SSH call, on any system
- Your SSH private key in a format plink can read (PuTTY `.ppk`)
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

## 2: Key Path

The server uses `~/.ssh/id_ed25519` (`~/.ssh/id_ed25519.ppk` on Windows). To use another key, set the environment variable `SSH_KEY_PATH` to its full path before starting the server.

---

## 3 — Configure Midnight Commander Menu

On the remote server, add an entry to `~/.config/mc/menu` (or the system menu):

```
v   View in MSA viewer
    echo "%d/%f" > /tmp/.msa_viewer_queue
```

Then in MC: `F2 → v` queues the currently highlighted file.

The server reads `/tmp/.msa_viewer_queue` on the remote machine. Make it writable by all users (so any login can write):
```bash
touch /tmp/.msa_viewer_queue
chmod 666 /tmp/.msa_viewer_queue
```

---

## 4 — Browser UI

1. Open the viewer. The first time in a browser, use the link the server printed when it started
   (`http://localhost:3000/?key=...`, also shown by `start-server.bat`): it carries your access key.
   Afterwards `http://localhost:3000` works. Without the key the server buttons do not appear.
2. The **Input** section shows a row of server buttons (one per entry in `ssh-servers.json`)
3. Navigate to a file in MC and press `F2 → v`
4. In the browser:
   - Click **Check Queue** for the selected server. Nothing polls in the background.

A mini-console appears in the bottom-right corner showing the fetch progress:
```
Checking myserver...
Found: alignment.fas - fetching...
[OK] alignment.fas | 127 seqs | myserver
```
It closes by itself a few seconds after success. On error it stays open and shows the error in red.

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
- The inner `ssh` accepts a new host key on first contact (`StrictHostKeyChecking=accept-new`); `hostKey` pins only the first hop

---

## Troubleshooting

### "Queue check failed: FATAL ERROR: Cannot confirm a host key in batch mode"

plink cannot accept the host key non-interactively. Fix:
- Add the `hostKey` fingerprint to `ssh-servers.json` (see step 1)
- Or open PuTTY GUI once, connect to the server, and accept the key to add it to the registry

### "Queue check failed: HTTP 500"

The server returned a non-zero plink exit code. The real error is now shown in the mini-console and in the Node console log (`[POLL] serverKey failed: ...`). Common causes:
- Wrong key path (set `SSH_KEY_PATH`)  
- Wrong `host`/`port`/`user` in `ssh-servers.json`
- SSH tunnel down (check that port forwarding is active)

### "No file queued on server-name"

Queue file `/tmp/.msa_viewer_queue` on the remote server is empty. Either:
- MC menu entry was not triggered yet
- Queue was already consumed by a previous poll
- Path in MC menu entry is wrong (check `%d/%f` expansion)
