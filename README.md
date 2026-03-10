# MSA Viewer

A fast, interactive HTML-based MSA viewer for FASTA/MSF/NEXUS alignments, with local BLAST search and remote file loading via SSH.

## Features

- **Interactive Alignment Viewer**: Scroll, zoom, highlight, color schemes
- **Sequence Search**: Local BLAST search against loaded databases (RepBase, custom collections)
- **Remote File Loading**: SSH to multiple servers (direct or via jump hosts)
  - Manual: Paste file path and click "Fetch"
  - Via Midnight Commander: Press `F2 → v` in MC, then click "Check Queue" to load
- **Drag-and-Drop Reordering**: Rearrange sequences in alignment
- **MSA Tools**: Multiple alignment, consensus extraction (with threshold control)
- **SINE Detection**: Identify and extract SINE-family sequences

## Quick Start

### Browser (HTML only)
Open `index.html` in any modern browser. Supports local file upload.

### Server Mode (Recommended)
```bash
npm install
node server.js
```
Visit `http://localhost:3000`

Enables:
- BLAST search
- Remote SSH file loading

## Remote File Loading Setup

See **[REMOTE_PUSH_TO_LOAD_GUIDE.md](REMOTE_PUSH_TO_LOAD_GUIDE.md)** for comprehensive setup instructions including:
- Configuring remote servers
- Installing MC menu entries
- Troubleshooting SS connections

### Quick Example

**On remote server:**
```bash
# Add to ~/.config/mc/menu
v   View in MSA viewer
	echo "%d/%f" > /tmp/.msa_viewer_queue &
```

**In browser:**
1. Open `http://localhost:3000`
2. Navigate file in MC, press `F2 → v`
3. Click **Check Queue** button
4. Alignment loads with auto-focus

## Configuration

Edit `server.js` to add or modify SSH servers:
```javascript
const SSH_SERVERS = {
    'myserver': {
        label: 'My Lab Server',
        user: 'username',
        host: 'server.example.com',
        via: null  // or 'gateway' for jump host
    }
};
```

## Demo Sequences

Includes sample SINE sequences:
- **RepBase.bnk**: ~49K SINE elements
- **RepBase_filtered.bnk**: Filtered high-confidence elements
- **SINEBase.nr95**: Non-redundant collection
- Custom Anolis sequences

## Security Notes

- SSH uses key-based auth (no passwords)
- Queue file at `/tmp/.msa_viewer_queue` must be world-writable (666)
- All file transfers encrypted over SSH
- Manual "Check Queue" button prevents continuous polling (safer for IDS-protected servers)

## Support

For issues or feature requests, see [GitHub Issues](https://github.com/Toki-bio/MSA-viewer/issues)

---

**Live Demo**: https://toki-bio.github.io/MSA-viewer
