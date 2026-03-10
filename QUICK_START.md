# QUICK START REFERENCE

## TL;DR - Get BLAST Running in 5 Steps

### 1. Install Node.js
https://nodejs.org/ → Download LTS → Run installer → **Check "Add to PATH"** → Restart computer

### 2. Install NCBI BLAST+
https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/ → Download x64-win64 exe → Run installer → **Check "Add to PATH"** → Restart computer

### 3. Verify Installations
```powershell
node --version      # Should show v18+ or v20+
blastn -version     # Should show BLAST version
```

### 4. Install Dependencies & Start Server
```powershell
cd C:\Users\toki\MSA-viewer
npm install
node server.js
```

### 5. Open Browser
http://localhost:3000

---

## Using BLAST Search

1. Load alignment in MSA Viewer
2. **Right-click any sequence**
3. Click **"BLAST Search"**
4. Select databases and E-value
5. Click **"Search"**
6. View results in modal with tabs

---

## File Reference

| File | Purpose |
|------|---------|
| server.js | BLAST server (new) |
| package.json | Dependencies: Express (new) |
| start-server.bat | Quick start script (new) |
| script.js | Added BLAST functions (modified) |
| styles.css | Added BLAST styling (modified) |

---

## Troubleshooting Quick Fixes

### "blastn not found"
→ Reinstall BLAST, check "Add to PATH", restart computer

### "npm not found"
→ Reinstall Node.js, check "Add to PATH", restart computer

### "Cannot connect to server"
→ Run `node server.js` and keep terminal open

### "Database file not found"
→ Check files exist: SINEBase.nr95.fa, RepBase.bnk, snake_gekko_SINEs_cons.fas

### "BLAST search fails"
→ Check server console for error message

---

## Documentation Files

Start here based on your situation:

- **Already have Node.js and BLAST?**
  → Go directly to step 4 above

- **Need installation help?**
  → Read: INSTALLATION.md (step-by-step guide)

- **Want to customize BLAST?**
  → Read: BLAST_SETUP.md (configuration options)

- **Want feature overview?**
  → Read: README_BLAST.md (complete documentation)

- **Debugging?**
  → Read: IMPLEMENTATION_SUMMARY.md (technical details)

---

## Test Commands

```powershell
# Test Node.js
node --version

# Test BLAST
blastn -version

# Check databases
Get-ChildItem C:\Users\toki\MSA-viewer\*.fa

# Start server
cd C:\Users\toki\MSA-viewer
node server.js

# Check server is running
curl http://localhost:3000/api/databases
```

---

## Common Ports & URLs

- **MSA Viewer**: http://localhost:3000
- **BLAST API**: http://localhost:3000/api/blast
- **Server port**: 3000 (can be changed in server.js)

---

## Key Shortcuts

| Action | Shortcut |
|--------|----------|
| Load alignment | Ctrl+L |
| Right-click menu | Right-click on sequence |
| BLAST Search | Right-click → "BLAST Search" |
| Close results | Click X or backdrop |
| Switch database tab | Click tab name |

---

## What Each Database Contains

| Database | Size | Content |
|----------|------|---------|
| SINEBase.nr95 | Large | Non-redundant SINE sequences |
| RepBase.bnk | Largest | Comprehensive repeat element database |
| snake_gekko_SINEs | Small | Snake and Gecko SINE consensus |

---

## Performance Tips

- **First search** is slower (BLAST initialization)
- **RepBase.bnk** takes longest (largest database)
- **Lower E-value** = faster but fewer results
- **Shorter sequences** = faster searches
- Consider splitting huge databases for speed

---

## Default Settings

| Setting | Value | Change in |
|---------|-------|-----------|
| Server Port | 3000 | server.js |
| E-value | 1e-5 | script.js |
| Max Hits | 10 | server.js |
| Databases | All 3 | script.js |

---

## Emergency Shutdown

If something goes wrong:

```powershell
# Ctrl+C in server terminal - kills server
Ctrl+C

# Kill all Node processes (Windows)
taskkill /F /IM node.exe

# Always safe: close terminal running server
```

---

## Next Steps

1. ✓ Install Node.js
2. ✓ Install NCBI BLAST+
3. ✓ Run `npm install`
4. ✓ Start server `node server.js`
5. ✓ Open http://localhost:3000
6. ✓ Load alignment
7. ✓ Right-click and search!

---

**Questions?** Check the relevant documentation file above.

**Ready?** Follow "TL;DR - Get BLAST Running in 5 Steps" above!
