# Installation Guide - Node.js and NCBI BLAST+

## Step 1: Install Node.js

### Download

1. Visit: **https://nodejs.org/**
2. Click the **LTS (Long Term Support)** button
   - Current LTS: v20.x.x (recommended)
3. This downloads the Windows installer (`.msi` file)

### Installation Steps

1. **Run the installer**
   - Double-click `node-vXX.X.X-x64.msi`
   - Click "Next" through the welcome screen

2. **Accept License Agreement**
   - Read and accept the Node.js license
   - Click "Next"

3. **Choose Destination Folder**
   - Default: `C:\Program Files\nodejs`
   - Click "Next" (keep default)

4. **Custom Setup**
   - Ensure all options are checked:
     - ☑ Node.js runtime
     - ☑ npm package manager
     - ☑ Add to PATH
   - Click "Next"

5. **Tools for Native Modules** (optional)
   - Can skip this for MSA Viewer
   - Click "Next"

6. **Click Install**
   - Wait for installation to complete
   - Click "Finish"

7. **Restart Your Computer**
   - Important! Changes won't take effect without restart

### Verify Installation

Open PowerShell and check versions:

```powershell
node --version
npm --version
```

You should see version numbers like:
```
v20.10.0
9.2.0
```

---

## Step 2: Install NCBI BLAST+

### Download

1. Visit: **https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/**
2. Look for files like: `ncbi-blast-2.XX.X+-x64-win64.exe`
3. Download the **latest x64-win64 version**

### Installation Steps

1. **Run the installer**
   - Double-click the downloaded `ncbi-blast-2.XX.X+-x64-win64.exe`
   - Click "Next" through welcome screen

2. **License Agreement**
   - Read and accept
   - Click "I Agree"

3. **Choose Destination Folder**
   - Default: `C:\Program Files\NCBI\blast-2.XX.X+`
   - Click "Next" (can keep default)

4. **Add to PATH** (IMPORTANT!)
   - Look for option like "Add installation directory to PATH"
   - ☑ Make sure this is checked
   - Click "Next" or "Install"

5. **Wait for installation to complete**
   - This may take a few minutes
   - Click "Finish"

6. **Restart Your Computer**
   - Critical for PATH changes to take effect

### Verify Installation

Open **new PowerShell window** and test:

```powershell
blastn -version
```

You should see output like:
```
blastn: 2.14.0+
  Package: blast 2.14.0+, build Windows 64-bit
```

If you get "command not found", the PATH wasn't set correctly. Try:
1. Uninstall BLAST
2. Reinstall and ensure "Add to PATH" is checked
3. Restart computer
4. Test again

---

## Step 3: Set Up MSA Viewer with BLAST

### Install NPM Packages

```powershell
cd C:\Users\toki\MSA-viewer
npm install
```

This creates `node_modules` folder with Express server.

### Start the Server

**Option A: Using batch script**
```powershell
cd C:\Users\toki\MSA-viewer
.\start-server.bat
```

**Option B: Manual**
```powershell
cd C:\Users\toki\MSA-viewer
node server.js
```

You should see:
```
MSA Viewer BLAST Server running on http://localhost:3000
Initializing BLAST databases...
Database status: {...}
```

### Open in Browser

1. Open web browser
2. Go to: **http://localhost:3000**
3. You should see the MSA Viewer interface

---

## Troubleshooting Installation

### Node.js Command Not Found

**Problem**: `node` or `npm` not recognized after installation

**Solution**:
1. Restart your computer (important!)
2. Open a NEW PowerShell window
3. Test: `node --version`

**If still not working:**
1. Uninstall Node.js (Settings > Apps > Apps & features)
2. Delete: `C:\Program Files\nodejs`
3. Restart computer
4. Reinstall, ensuring "Add to PATH" is checked
5. Restart computer again

### BLAST Command Not Found

**Problem**: `blastn` not recognized after installation

**Solution**:
1. Check if installed: Look in `C:\Program Files\NCBI\`
2. If not there, reinstall BLAST
3. During installation, ensure "Add to PATH" is checked
4. Restart computer
5. Test: `blastn -version`

### Can't find databases

**Problem**: "Database file not found" error when searching

**Solution**:
1. Verify these files exist in `C:\Users\toki\MSA-viewer`:
   - `SINEBase.nr95.fa`
   - `RepBase.bnk`
   - `snake_gekko_SINEs_cons.fas`

2. If missing, the database files need to be in that directory
3. Files should be FASTA format (.fa, .fasta, .fas)

---

## Quick Test

After everything is installed:

```powershell
# Test Node.js
node --version

# Test BLAST
blastn -version

# Test npm
npm --version

# Start server
cd C:\Users\toki\MSA-viewer
npm install
node server.js
```

If you see output for all commands and the server starts, everything is ready!

---

## Getting Help

If installation fails:
1. Check detailed error messages in the installer output
2. Verify files are in correct locations:
   - Node.js: `C:\Program Files\nodejs\`
   - BLAST: `C:\Program Files\NCBI\blast-X.XX.X+\`
3. Make sure PATH is updated:
   ```powershell
   $env:PATH
   ```
   Should include paths to Node.js and BLAST

4. Check that FASTA databases exist in:
   - `C:\Users\toki\MSA-viewer\*.fa`
   - `C:\Users\toki\MSA-viewer\*.fasta`
   - `C:\Users\toki\MSA-viewer\*.fas`
