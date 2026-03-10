$BLASTVersion = "2.15.0"
$DownloadURL = "https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/ncbi-blast-${BLASTVersion}+-x64-win64.exe"
$InstallerPath = "$env:TEMP\ncbi-blast-installer.exe"

Write-Host "Downloading NCBI BLAST+ v$BLASTVersion..."
Write-Host "URL: $DownloadURL"

try {
    # Download the installer
    Invoke-WebRequest -Uri $DownloadURL -OutFile $InstallerPath -UseBasicParsing
    Write-Host "✓ Downloaded to $InstallerPath"
    
    # Run the installer silently
    Write-Host "Installing BLAST+... (this may take a minute)"
    Start-Process -FilePath $InstallerPath -ArgumentList "/S", "/D=C:\Program Files\NCBI\blast-${BLASTVersion}+" -Wait
    
    Write-Host "✓ Installation complete!"
    Write-Host ""
    Write-Host "Verifying installation..."
    $env:Path = "$env:Path;C:\Program Files\NCBI\blast-${BLASTVersion}+\bin"
    
    blastn -version
    Write-Host ""
    Write-Host "✓ BLAST+ is ready!"
    
} catch {
    Write-Host "Error: $_"
    Write-Host ""
    Write-Host "Manual installation needed"
}

# Cleanup
if (Test-Path $InstallerPath) {
    Remove-Item $InstallerPath -Force
}
