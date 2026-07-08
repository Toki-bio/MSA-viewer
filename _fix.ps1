$js = [System.IO.File]::ReadAllText("C:\Users\T\.openclaw-autoclaw\workspace\msa-viewer-fix\script.js", [System.Text.UTF8Encoding]::new($false))
$html = [System.IO.File]::ReadAllText("C:\Users\T\.openclaw-autoclaw\workspace\msa-viewer-fix\index.html", [System.Text.UTF8Encoding]::new($false))

# ===== FIX 1: Letters - invert match check for SPIN mode =====
$oldLetter = "if (id[idx] > 240 && id[idx+1] > 240 && id[idx+2] > 240) continue;"
$newLetter = "const isMatch = S.spinMode ? (S.matchMap && S.matchMap[i * S.cols + j]) : (id[idx] < 128);`r`n                if (!isMatch) continue;"
$js = $js.Replace($oldLetter, $newLetter)
Write-Host "FIX 1 (letters): SPIN uses matchMap, Doter uses dark pixels"

# ===== FIX 2: dblclick handler =====
$clickEnd = "showMessage(`$" + "{Pinned: A${row + 1} / B${col + 1}. Click \`"Copy Region\`" to copy FASTA.}, 2500);`r`n        });`r`n        // Wheel zoom: capture on dialog to prevent modal scroll, zoom on viewport"
$dblclick = @"
showMessage(`Pinned: A`${row + 1} / B`${col + 1}. Click \"Copy Region\" to copy FASTA., 2500);
        });
        // Double-click to freeze/unfreeze alignment panel
        overlay.addEventListener('dblclick', (e) => {
            const S = _dotPlotState;
            if ((!S.scores && !S.matchMap)) return;
            e.preventDefault();
            const rect = overlay.getBoundingClientRect();
            const col = Math.floor((e.clientX - rect.left - DOT_AXIS_PAD) / S.zoom);
            const row = Math.floor((e.clientY - rect.top - DOT_AXIS_PAD) / S.zoom);
            if (row < 0 || col < 0 || row >= S.rows || col >= S.cols) return;
            if (S._frozen) {
                _dotUnfreeze();
                showMessage('Unfrozen.', 1500);
            } else {
                S.pinnedRow = row; S.pinnedCol = col;
                _dotUpdateHoverInfo(row, col);
                S._frozen = true;
                S._frozenRow = row; S._frozenCol = col; S._frozenSlider = 0;
                _dotUpdateSpinScroll();
                _dotDrawOverlay(row, col);
                showMessage('FROZEN \u2014 double-click to unfreeze.', 3000);
            }
        });
        // Wheel zoom: capture on dialog to prevent modal scroll, zoom on viewport
"@

if ($js.Contains($clickEnd)) {
    $js = $js.Replace($clickEnd, $dblclick)
    Write-Host "FIX 2 (dblclick): Handler added"
} else {
    Write-Host "FIX 2 FAILED - trying alternate search"
    $alt = "showMessage(`$" + "{Pinned:`r`n"
    if ($js.Contains("Pinned: A$")) {
        Write-Host "  Alt search found Pinned"
    }
}

# ===== FIX 3: Replace freeze slider HTML with SPIN scroll buttons =====
$oldSlider = @'
            <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
                <span id="dotPlotFreezeLabel" style="display:none;font-size:11px;color:#4a9eff;font-weight:bold;">Slider: 0</span>
                <input type="range" id="dotPlotFreezeSlider" style="display:none;flex:1;height:14px;" min="-50" max="50" value="0" title="Scroll along diagonal">
            </div>
'@

$newScroll = @'
            <div id="dotPlotSpinScroll" style="display:none;align-items:center;gap:3px;margin-top:3px;padding:2px 0;font-size:12px;">
                <button id="spinScrollLL" title="Scroll left 10bp" style="padding:1px 8px;cursor:pointer;border:1px solid #ccc;border-radius:3px;background:#f5f5f5;">&#171;</button>
                <button id="spinScrollL"  title="Scroll left 1bp"  style="padding:1px 6px;cursor:pointer;border:1px solid #ccc;border-radius:3px;background:#f5f5f5;">&#8249;</button>
                <span id="spinScrollLabel" style="font-size:11px;color:#4a9eff;font-weight:bold;min-width:55px;text-align:center;">Pos: 0</span>
                <button id="spinScrollR"  title="Scroll right 1bp"  style="padding:1px 6px;cursor:pointer;border:1px solid #ccc;border-radius:3px;background:#f5f5f5;">&#8250;</button>
                <button id="spinScrollRR" title="Scroll right 10bp" style="padding:1px 8px;cursor:pointer;border:1px solid #ccc;border-radius:3px;background:#f5f5f5;">&#187;</button>
                <span style="width:6px;"></span>
                <button id="spinLockBtn" title="Lock sequences for synchronized scrolling" style="padding:1px 6px;cursor:pointer;border:1px solid #ccc;border-radius:3px;background:#f5f5f5;">&#128275;</button>
            </div>
'@

if ($html.Contains($oldSlider)) {
    $html = $html.Replace($oldSlider, $newScroll)
    Write-Host "FIX 3 (HTML): SPIN scroll bar replaces freeze slider"
} else {
    # Try simpler search
    if ($html.Contains('dotPlotFreezeSlider')) {
        Write-Host "FIX 3: freezeSlider found but pattern mismatch - trying regex"
        $pattern = '(?s)<div style="display:flex;align-items:center;gap:6px;margin-top:2px;">.*?dotPlotFreezeSlider.*?</div>'
        $html = $html -replace $pattern, $newScroll.Trim()
        Write-Host "FIX 3 (HTML): SPIN scroll bar via regex"
    } else {
        Write-Host "FIX 3 FAILED - freezeSlider not in HTML"
    }
}

# ===== Verify and write =====
[System.IO.File]::WriteAllText("C:\Users\T\.openclaw-autoclaw\workspace\msa-viewer-fix\script.js", $js, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText("C:\Users\T\.openclaw-autoclaw\workspace\msa-viewer-fix\index.html", $html, [System.Text.UTF8Encoding]::new($false))
Write-Host "Files written."
