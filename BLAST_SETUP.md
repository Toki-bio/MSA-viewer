# MSA Viewer with BLAST Search - Setup Guide

## Overview

This enhanced MSA Viewer now includes local BLAST search functionality. You can right-click on any sequence and search it against three FASTA databases:
- **SINEBase.nr95.fa** - Non-redundant SINE sequences
- **RepBase.bnk** - RepBase database
- **snake_gekko_SINEs_cons.fas** - Snake and Gekko SINE consensus sequences

Results are displayed with full alignments showing matches, identities, E-values, and bit scores.

## Prerequisites

### 1. Install Node.js (Required)

Download and install Node.js from: https://nodejs.org/

Recommended: LTS version (v18 or v20)

Verify installation:
```powershell
node --version
npm --version
```

### 2. Install NCBI BLAST+ (Required)

The BLAST search feature requires NCBI BLAST+ tools to be installed and available in your system PATH.

#### Windows Installation:

**Option A: Download from NCBI (Recommended)**
1. Visit: https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/
2. Download: `ncbi-blast-2.XX.X+-x64-win64.exe`
3. Run the installer
4. When prompted, **make sure to enable "Add to PATH"**
5. Restart your computer after installation

**Option B: Using Chocolatey (if installed)**
```powershell
choco install blast
```

**Verify Installation:**
```powershell
blastn -version
```

You should see output like:
```
blastn: 2.XX.X+
  Package: blast 2.XX.X+, build XXX (XXXX-XX-XX T)
```

## Setup Instructions

### Step 1: Install Dependencies

Navigate to the MSA Viewer directory and install Node.js dependencies:

```powershell
cd C:\Users\toki\MSA-viewer
npm install
```

This creates a `node_modules` folder and installs Express server dependencies.

### Step 2: Format BLAST Databases (First Time Only)

The BLAST databases need to be indexed. This happens automatically when you first start the server:

```powershell
node server.js
```

You'll see output like:
```
MSA Viewer BLAST Server running on http://localhost:3000
Initializing BLAST databases...
Database status: {
  'SINEBase.nr95': { exists: true, formatted: true },
  'RepBase.bnk': { exists: true, formatted: true },
  'snake_gekko_SINEs': { exists: true, formatted: true }
}
```

If you see `formatted: false`, there may be an issue with BLAST installation. Verify that BLAST is in your PATH.

## Usage

### Starting the Server

```powershell
cd C:\Users\toki\MSA-viewer
node server.js
```

The server runs on `http://localhost:3000` and serves both the web interface and API.

### Using BLAST Search

1. **Load your alignment** into the MSA Viewer as usual
2. **Right-click on any sequence** in the alignment
3. Select **"BLAST Search"** from the context menu
4. A dialog appears where you can:
   - Select which databases to search (all are selected by default)
   - Set the E-value threshold (default: 1e-5)
   - Click "Search"
5. Results open in a new modal showing:
   - Tabs for each database searched
   - List of matching sequences
   - Full alignment details including:
     - Bit score
     - E-value
     - Identity percentage
     - Query and subject sequence alignment with midline

## Features

- **Multi-database search**: Search against all three databases simultaneously
- **Customizable E-value**: Adjust sensitivity of results
- **Alignment details**: View full pairwise alignments with identity markers
- **Clean interface**: Results displayed in tabbed interface for easy navigation
- **Top hits only**: Shows up to 10 best matches per database
- **Automatic database formatting**: BLAST indices are created automatically on first run

## Advanced Configuration

### Changing Database Paths

To use different FASTA files, edit the `DATABASES` object in `server.js`:

```javascript
const DATABASES = {
    'Database Name': 'path/to/your/database.fasta',
    'SINEBase.nr95': path.join(__dirname, 'SINEBase.nr95.fa'),
    'RepBase.bnk': path.join(__dirname, 'RepBase.bnk'),
    'snake_gekko_SINEs': path.join(__dirname, 'snake_gekko_SINEs_cons.fas')
};
```

### Changing Server Port

Edit the `PORT` variable in `server.js`:

```javascript
const PORT = 3001;  // Change from 3000
```

Then update the fetch URL in `script.js`:

```javascript
const response = await fetch('http://localhost:3001/api/blast', {
```

### Adjusting Maximum Hits

Modify in `server.js`:

```javascript
return results.slice(0, 20);  // Show top 20 instead of 10
```

## Troubleshooting

### "Command 'blastn' not found"

**Problem**: BLAST is not installed or not in PATH

**Solution**:
1. Verify BLAST installation: `blastn -version`
2. If not found, reinstall BLAST and select "Add to PATH"
3. Restart your computer after installation
4. Restart the server: `node server.js`

### "Database file not found"

**Problem**: FASTA files are missing or in wrong location

**Solution**:
1. Verify files exist in `C:\Users\toki\MSA-viewer`:
   - `SINEBase.nr95.fa`
   - `RepBase.bnk`
   - `snake_gekko_SINEs_cons.fas`
2. Update paths in `server.js` DATABASES object if files are elsewhere

### "Cannot connect to server"

**Problem**: Server not running

**Solution**:
1. Open PowerShell in MSA Viewer directory
2. Run: `node server.js`
3. Leave the window open while using the application
4. Open browser to `http://localhost:3000`

### BLAST search fails with error

**Problem**: BLAST process crashes or returns error

**Common causes**:
- Database not properly formatted (wait for first run to complete)
- BLAST not in PATH (verify: `blastn -version`)
- Sequence too short or invalid
- Insufficient disk space for temp files

**Solution**:
1. Check server console for error messages
2. Try running BLAST manually:
   ```powershell
   blastn -query test.fasta -db "C:\Users\toki\MSA-viewer\SINEBase.nr95" -outfmt 5
   ```

## Technical Details

### API Endpoints

**POST /api/blast**
- Search single database
- Body: `{ query, dbName, evalue, maxHits }`
- Returns: Structured hit results with HSPs

**POST /api/blast-all**
- Search all databases at once
- Body: `{ query, evalue }`
- Returns: Results from all databases

**GET /api/databases**
- Check database configuration and status

### Files Modified/Added

- **server.js** (NEW) - Express server for BLAST integration
- **package.json** (NEW) - Node.js dependencies
- **script.js** - Added BLAST search functions and UI handlers
- **styles.css** - Added BLAST UI styling

## Performance Notes

- BLAST searches typically take 5-30 seconds depending on database size
- Search time increases with sequence length and decreases with E-value threshold
- Larger databases (RepBase.bnk, SINEBase.nr95) take longer than smaller ones

## Next Steps

1. Install Node.js dependencies: `npm install`
2. Install NCBI BLAST+
3. Start server: `node server.js`
4. Open browser to `http://localhost:3000`
5. Load a sequence alignment
6. Right-click on a sequence and select "BLAST Search"

Enjoy searching!
