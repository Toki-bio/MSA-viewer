# Remote File Push-to-Load via Midnight Commander

A comprehensive guide to setting up one-click alignment file loading from remote servers directly into the MSA Viewer.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [How It Works](#how-it-works)
3. [Prerequisites](#prerequisites)
4. [Setup Instructions](#setup-instructions)
5. [Configuration](#configuration)
6. [Troubleshooting](#troubleshooting)
7. [Security Considerations](#security-considerations)

---

## Architecture Overview

The system enables users to load alignment files from remote servers into the MSA Viewer browser interface with **one keystroke in Midnight Commander**.

### Components

- **MSA Viewer Server** (Node.js): Express backend running on `localhost:3000`
- **Remote Servers**: Accepts SSH connections from the viewer server
- **Midnight Commander (MC)**: File manager with custom menu entries on remote servers
- **Queue File**: Shared `/tmp/.msa_viewer_queue` as a push communication channel
- **Browser Frontend**: Polls for queued files and auto-loads them

### Data Flow

```
User: "F2 → V" in MC (on remote server)
  ↓
MC menu writes file path to /tmp/.msa_viewer_queue
  ↓
Browser polls /api/ssh-poll-file every 3 seconds
  ↓
Server reads queue, fetches file content via SSH
  ↓
Browser loads alignment in viewer + auto-focus/notification
```

---

## How It Works

### Step 1: User Action on Remote Server

```bash
# In Midnight Commander on a remote server:
# Navigate to an alignment file (FASTA, MSF, etc.)
# Press: F2 (menu) → V (View in MSA viewer)
# Result: File path written to /tmp/.msa_viewer_queue
```

### Step 2: Queue File Format

When user presses the menu item, MC expands variables and writes:

```
/staging/user/alignment_file.fa.al
```

Or (if using older format):
```
/staging/user
alignment_file.fa.al
```

### Step 3: Browser Polling

JavaScript on the viewer continuously checks for queued files:

```javascript
// Every 3 seconds:
GET /api/ssh-poll-file?server=copilot
→ Returns: { queued: true, file: "/staging/user/alignment_file.fa.al", server: "copilot" }
```

### Step 4: File Fetch & Display

```
GET /api/ssh-cat?file=/staging/user/alignment_file.fa.al&server=copilot
→ Server SSH's to remote, cats file content
→ Browser parses and renders alignment
→ Title bar flashes: "★ LOADED: alignment_file.fa.al"
→ Desktop notification (if allowed)
→ Browser window auto-focuses
```

---

## Prerequisites

### Local (Viewer Server)

- **Node.js** (v14+)
- **npm** (for dependencies)
- Network access to remote servers (SSH, ports 22)

### Remote Servers

- **Midnight Commander** (`mc` package)
- **SSH server** (OpenSSH or compatible)
- **User writable `/tmp` directory** (or symlink to shared storage)
- **BASH** (for MC menu command line)

---

## Setup Instructions

### 1. Server Configuration

Edit [server.js](./server.js) to add your remote servers:

```javascript
const SSH_SERVERS = {
    'my-server': {
        label: 'My Research Server',
        user: 'username',
        host: 'server.example.com',
        via: null  // null = direct SSH, or 'server-key' for jump host
    },
    'via-jump': {
        label: 'Server Behind Jump Host',
        user: 'user2',
        host: 'internal.example.com',
        via: 'my-server'  // route through 'my-server' first
    }
};
```

**Important**: Only `direct` servers (where `via: null`) can poll for queue files. Jump-host servers will time out during polling.

### 2. Install Node Dependencies

```bash
npm install
```

### 3. Remote Server: Create MC Menu Entry

On each remote server, add the following to `~/.config/mc/menu`:

```bash
# On the remote server, as your user:
cat >> ~/.config/mc/menu << 'EOF'

v   View in MSA viewer
	echo "%d/%f" > /tmp/.msa_viewer_queue &
EOF
```

**Format Requirements:**
- `v` = hotkey
- Three spaces after `v`
- Text = menu label
- **Next line must start with a TAB** (not spaces!)
- Command: `echo "%d/%f" > /tmp/.msa_viewer_queue &`
  - `%d` = current directory (MC expands)
  - `%f` = selected file (MC expands)
  - `&` = run in background (required for MC menu)

### 4. Create Queue File

On each remote server:

```bash
touch /tmp/.msa_viewer_queue
chmod 666 /tmp/.msa_viewer_queue
```

If `/tmp` is not shared between users, use an alternative path:

```bash
mkdir -p /shared/msa_queue
touch /shared/msa_queue/queue_file
chmod 666 /shared/msa_queue/queue_file
```

Then update server.js:
```javascript
const QUEUE_PATH = '/shared/msa_queue/queue_file';
```

### 5. Start the Viewer Server

```bash
node server.js
```

Server should output:
```
MSA Viewer server running on http://localhost:3000
[POLL] Checking queue for server: my-server
```

### 6. Test in Browser

1. Open `http://localhost:3000` in a browser
2. SSH to a remote server
3. Open Midnight Commander: `mc`
4. Navigate to an alignment file (`.fa`, `.fasta`, `.msf`, etc.)
5. Press `F2` → `v` (View in MSA viewer)
6. Watch the browser — file should load within 3 seconds
7. Title should flash `★ LOADED: filename.fa`

---

## Configuration

### Advanced SSH Options

If your remote server requires special SSH options:

```javascript
// In buildSshCatArgs(), modify the ssh spawn args:
return [
    '-T',                           // Disable pseudo-terminal
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    '-o', 'BatchMode=yes',          // No interactive prompts
    '-o', 'UserKnownHostsFile=/dev/null',  // Skip known_hosts check
    `${srv.user}@${srv.host}`,
    `cat "${escaped}"`
];
```

### Polling Interval

In [script.js](./script.js), adjust the polling delay (default 3 seconds):

```javascript
async function _pollLoop() {
    while (_sshPollRunning) {
        try {
            await _pollQueuedFile();
        } catch (e) {
            console.log(`[POLL] Loop error: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 3000));  // ← Change here
    }
}
```

### MOTD Banner Stripping

If remote servers output MOTD banners before file content, the viewer auto-strips them using markers:

```javascript
// In /api/ssh-poll-file:
const startMarker = '=START_QUEUE=';
const endMarker = '=END_QUEUE=';
```

If banners still appear in loaded files, update `stripBanner()` function:

```javascript
function stripBanner(stdout) {
    // Skip lines until we find FASTA (>) or MSF (!!) header
    const fastaStart = stdout.indexOf('>');
    const msfStart   = stdout.indexOf('!!');
    if (fastaStart > 0 && (msfStart < 0 || fastaStart < msfStart)) {
        return stdout.substring(fastaStart);
    }
    if (msfStart > 0) return stdout.substring(msfStart);
    return stdout;
}
```

### Auto-Focus Customization

Browser notifications and window focus are triggered on file load:

```javascript
// In fetchFileFromServer():
window.focus();                    // Attempt to focus window

// Title bar flashing:
document.title = `★ LOADED: ${fname}`;

// Desktop notification:
if (Notification.permission === 'granted') {
    new Notification('MSA Viewer', { body: `Loaded ${fname}` });
}
```

---

## Troubleshooting

### File Won't Load

**Symptom**: Browse file in MC, press `F2 → v`, nothing happens.

**Check:**
1. Queue file exists and is writable:
   ```bash
   ls -la /tmp/.msa_viewer_queue
   # Should show: -rw-rw-rw- (666 permissions)
   ```

2. MC menu syntax is correct:
   ```bash
   grep -A1 "View in MSA" ~/.config/mc/menu
   # Should show:
   # v   View in MSA viewer
   # 	echo "%d/%f" > /tmp/.msa_viewer_queue &
   # (second line MUST start with literal TAB, not spaces)
   ```

3. Server can SSH to remote:
   ```bash
   ssh user@host "echo OK"
   # Should output: OK
   ```

4. Browser console has no errors:
   - Open DevTools (F12)
   - Check Console tab for `[POLL]` debug messages
   - Should show: `[POLL] Local queue detected: /path/to/file`

### Queue File Always Empty

**Symptom**: Server polls but returns `filePath=""`.

**Causes:**

- **MC menu not triggered**: Verify you pressed `F2 → v` in MC (not other interface)
- **Queue path wrong**: Check server.js has correct poll path
- **File not writable by MC user**: 
  ```bash
  touch /tmp/.msa_viewer_queue
  chmod 666 /tmp/.msa_viewer_queue
  ```
- **MC version too old**: Some very old MC versions don't support custom menus

**Debug:**
```bash
# On remote server, manually test the echo command:
mkdir -p /tmp/test
echo "/path/to/test.fa" > /tmp/.msa_viewer_queue
cat /tmp/.msa_viewer_queue
# Should output: /path/to/test.fa
```

### SSH Connection Timeout

**Symptom**: Server logs show polling but commands timeout.

**Causes:**

1. **Jump host servers (via != null) can't poll**: Only direct servers are polled. Remove `via` to make it direct, or accept that polling only works for direct servers.

2. **Network unreachable**: Verify connectivity:
   ```bash
   ssh -o ConnectTimeout=5 user@host "echo OK"
   ```

3. **Firewall blocking SSH**: Contact server admin.

### Browser Never Focuses

**Symptom**: File loads successfully but browser Window stays in background.

**Causes:**

- Modern browsers restrict `window.focus()` for security
- **Workaround**: Title bar flashing and desktop notifications are more reliable
  - Allow notifications in browser settings
  - Check taskbar for MSA Viewer window (will pulse/flash title)

### FASTA/MSF Files Don't Parse

**Symptom**: File loads but no alignment appears.

**Check:**

1. File is valid FASTA/MSF:
   ```bash
   head /path/to/file.fa
   # Should start with: > or !!
   ```

2. Banner wasn't stripped correctly. Server logs will show what was fetched. Open browser console and check `[SSH-CAT]` messages.

3. File encoding issues (if from Windows server):
   ```bash
   # On remote server, convert line endings:
   dos2unix /path/to/file.fa
   ```

---

## Security Considerations

### SSH Keys

- Use **key-based authentication** (no passwords in server.js)
- Place private key in `~/.ssh/` with **600 permissions**
- Example server.js for jump host SSH requires key in `~/.ssh/id_rsa` (default)

### Queue File Permissions

- `/tmp/.msa_viewer_queue` must be **world-writable** (666)
- Any user can overwrite the queue ⚠️
- **Mitigation**: Use a shared group directory:
  ```bash
  mkdir -p /var/queue/msa
  chown :msa_users /var/queue/msa
  chmod 775 /var/queue/msa
  ```
- Update server.js `QUEUE_PATH` accordingly

### File Access Control

- Server can only read files accessible via SSH user account
- If SSH user is `bioinfo`, alignment files must be readable by `bioinfo`
- No additional privilege escalation possible

### Network Traffic

- All file transfers over SSH (encrypted)
- Consider VPN/jump hosts for untrusted networks
- Don't expose port 3000 to untrusted networks

---

## Examples

### Example 1: Single Direct Server

```javascript
const SSH_SERVERS = {
    'lab-server': {
        label: 'Lab Storage Server',
        user: 'bioinfo',
        host: '192.168.1.100',
        via: null
    }
};
```

**MC Menu on lab-server:**
```
v   View in MSA Viewer
	echo "%d/%f" > /tmp/.msa_viewer_queue &
```

**Usage**: Press `F2 → v` on any alignment file in MC.

---

### Example 2: HPC with Jump Host

```javascript
const SSH_SERVERS = {
    'gateway': {
        label: 'HPC Gateway',
        user: 'hpc-user',
        host: 'gateway.hpc.edu',
        via: null
    },
    'compute': {
        label: 'HPC Compute Node',
        user: 'hpc-user',
        host: 'node03.internal',
        via: 'gateway'
    }
};
```

**Note**: Only `gateway` will be polled. `compute` will respond to file fetch requests but won't auto-load. Workaround: copy file to gateway first, or use direct access.

---

### Example 3: Multiple Servers with Different Users

```javascript
const SSH_SERVERS = {
    'lab': {
        label: 'Lab Server',
        user: 'alice',
        host: 'lab.example.com',
        via: null
    },
    'backup': {
        label: 'Backup Archive',
        user: 'bob',
        host: 'archive.example.com',
        via: null
    }
};
```

**Dropdown in browser**: Users select which server to poll from.

---

## Support & Contribution

For bugs, feature requests, or improvements:

1. Check existing [GitHub Issues](https://github.com/Toki-bio/MSA-viewer/issues)
2. Create a new issue with:
   - OS/Node.js version
   - Remote server info (distro, MC version)
   - Steps to reproduce
   - Console output (F12 → Console tab)

---

**Last Updated**: March 2026  
**Maintainer**: MSA-Viewer Project
