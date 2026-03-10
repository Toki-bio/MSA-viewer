# MSA Viewer with Local BLAST Search

An enhanced Multiple Sequence Alignment (MSA) viewer with integrated local BLAST search capabilities against custom FASTA databases.

## Features

✨ **Key Capabilities:**
- **Right-click BLAST search** - Search sequences directly from alignment view
- **Multi-database search** - Query multiple databases simultaneously
- **Full alignments** - View complete pairwise alignments with BLAST output
- **Custom E-value thresholds** - Control search sensitivity
- **Tabbed results** - Organize results by database
- **Top hits** - Get the best matches from each database

## Quick Start

### Prerequisites

Before using the BLAST feature, you need:

1. **Node.js** - Download from https://nodejs.org/ (LTS recommended)
2. **NCBI BLAST+** - Download from https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/
3. **Three FASTA databases** (already in your directory):
   - `SINEBase.nr95.fa`
   - `RepBase.bnk`
   - `snake_gekko_SINEs_cons.fas`

**See [INSTALLATION.md](INSTALLATION.md) for detailed setup instructions.**

### Installation

```powershell
# Navigate to MSA Viewer directory
cd C:\Users\toki\MSA-viewer

# Install dependencies
npm install
```

### Running the Server

```powershell
# Start the BLAST server
node server.js
```

or use the batch script:

```powershell
# Windows batch file
.\start-server.bat
```

### Using BLAST Search

1. **Load your alignment** - Use the Input section to load a FASTA or MSF file
2. **Right-click on any sequence** in the alignment
3. **Select "BLAST Search"** from the context menu
4. **Configure search:**
   - Choose which databases to search (default: all)
   - Set E-value threshold (default: 1e-5)
   - Click "Search"
5. **View results** - A modal opens with:
   - Tabbed results for each database
   - List of matching sequences
   - Full alignment details with scores

## Search Results

For each match, you see:

```
Hit: [Sequence ID and description]
  Score: 123.5 bits
  E-value: 1.2e-35
  Identity: 250/300 (83.3%)
  
  Query  1234-1534  ATCCGGATTCCAGTA...
                    ||||||| |||||||||
  Sbjct  5678-5878  ATCCGGATACCAGTA...
```

## File Structure

```
MSA-viewer/
├── index.html                # Main web interface
├── script.js                # MSA viewer logic + BLAST UI handlers
├── styles.css               # Styling including BLAST UI
├── server.js                # Node.js server for BLAST integration
├── package.json             # Dependencies (Express)
├── start-server.bat         # Quick start script
│
├── SINEBase.nr95.fa         # Database 1
├── RepBase.bnk              # Database 2  
├── snake_gekko_SINEs_cons.fas # Database 3
│
├── INSTALLATION.md          # Setup instructions
├── BLAST_SETUP.md          # Detailed BLAST configuration
└── README.md               # This file
```

## Configuration

### Databases

To add or change databases, edit `server.js`:

```javascript
const DATABASES = {
    'SINEBase.nr95': path.join(__dirname, 'SINEBase.nr95.fa'),
    'RepBase.bnk': path.join(__dirname, 'RepBase.bnk'),
    'snake_gekko_SINEs': path.join(__dirname, 'snake_gekko_SINEs_cons.fas'),
    'MyNewDB': path.join(__dirname, 'my_sequences.fasta')
};
```

### Server Settings

**Port** (in server.js):
```javascript
const PORT = 3000;  // Change port here
```

Then update fetch URL in script.js:
```javascript
const response = await fetch('http://localhost:3000/api/blast', {
```

**E-value default** (in showBlastDialog function in script.js):
```javascript
evalueInput.value = '1e-5';  // Change default here
```

## API Endpoints

The server provides REST endpoints for BLAST searches:

### POST /api/blast
Search a single database
```json
{
  "query": ">seqname\nATGC...",
  "dbName": "SINEBase.nr95",
  "evalue": "1e-5",
  "maxHits": 10
}
```

### POST /api/blast-all
Search all databases
```json
{
  "query": ">seqname\nATGC...",
  "evalue": "1e-5"
}
```

### GET /api/databases
Check database status
```json
{
  "SINEBase.nr95": {
    "path": "C:\\...",
    "exists": true,
    "formatted": true
  },
  ...
}
```

## Troubleshooting

### BLAST Command Not Found
```
Error: BLAST search failed - blastn not found
```
- Verify BLAST installation: `blastn -version`
- Check it's in PATH (restart after installation)
- See [INSTALLATION.md](INSTALLATION.md)

### Database File Not Found
```
Error: Database file not found
```
- Check files exist:
  - `SINEBase.nr95.fa`
  - `RepBase.bnk`
  - `snake_gekko_SINEs_cons.fas`
- Verify they're in `C:\Users\toki\MSA-viewer\`
- Check file permissions (readable)

### Server Won't Start
```
Error: Cannot find module 'express'
```
- Run: `npm install` in the MSA Viewer directory
- Ensure Node.js is installed: `node --version`

### Cannot Connect to Server
```
Error: Failed to fetch (connection refused)
```
- Ensure server is running: `node server.js`
- Keep terminal window open while using app
- Check it's running on correct port (default: 3000)
- Try: `http://localhost:3000` in browser

### Search Returns No Results
- Increase E-value threshold (e.g., 1e-3)
- Verify database files contain relevant sequences
- Try shorter sequence for faster search
- Check BLAST output manually:
  ```powershell
  blastn -query test.fasta -db "C:\...\SINEBase.nr95" -outfmt 5
  ```

## Performance Tips

1. **Large databases** (RepBase.bnk) will take longer
2. **Longer sequences** = slower searches
3. **Lower E-value** = faster but fewer results
4. **First search** may be slow while BLAST caches
5. Consider splitting huge databases for faster searches

## Architecture

```
Browser (MSA Viewer UI)
        ↓
  index.html/script.js
        ↓
   Right-click menu → BLAST Search
        ↓
  POST request to /api/blast
        ↓
   Node.js Server (server.js)
        ↓
  Execute blastn command
        ↓
  Parse XML output
        ↓
  Return JSON with hits
        ↓
  Display results modal
```

## Browser Compatibility

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- IE11: ❌ Not supported

## Files Modified

- **script.js** - Added BLAST functions:
  - `showBlastDialog()` - Database selection dialog
  - `runBlastSearch()` - Execute BLAST via API
  - `displayBlastResults()` - Render results modal
  - Context menu integration

- **styles.css** - Added BLAST styling:
  - `.blast-*` classes for dialogmodals
  - Tabs and results display
  - Alignment formatting

- **index.html** - No changes (uses existing structure)

## New Files

- **server.js** - Express server with BLAST integration
- **package.json** - Node.js dependencies
- **INSTALLATION.md** - Installation instructions  
- **BLAST_SETUP.md** - Detailed configuration guide

## Limitations

- Server must be running (`node server.js`)
- BLAST must be installed on the system
- Database files must be in specified directory
- XML output format required
- Max 10 hits displayed per database

## Future Enhancements

Possible improvements:
- [ ] BLASTP/BLASTX support
- [ ] Multiple sequence search
- [ ] Save results to file
- [ ] Batch processing
- [ ] Web-based BLAST alternative (if no local install)
- [ ] Custom BLAST parameters UI
- [ ] Results filtering/sorting
- [ ] Export alignments

## Support

For issues:
1. Check [INSTALLATION.md](INSTALLATION.md) for setup help
2. Check [BLAST_SETUP.md](BLAST_SETUP.md) for configuration
3. Check server console output for error messages
4. Verify prerequisites are installed
5. Test BLAST manually: `blastn -help`

## License

This enhancement maintains the original MSA Viewer license.

## Credits

- MSA Viewer original interface
- NCBI BLAST+ for sequence searching
- Express.js for server framework
- SINE database sequences from RepBase and SINEBase

---

**Ready to search?** Follow [INSTALLATION.md](INSTALLATION.md) to get started!
