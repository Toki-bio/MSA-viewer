# Prompt for a web-reading auditor (Qwen and similar)

Copy everything between the lines, and replace AREA with what to audit.

---
You are auditing ViewAlign, a browser alignment viewer (https://github.com/Toki-bio/MSA-viewer).
Area to audit: AREA

HOW TO READ THE CODE (strict):
1. Start with https://raw.githubusercontent.com/Toki-bio/MSA-viewer/audit-chunks/INDEX.md. It lists every source
   piece (each under 30 KB) with its file and original line range, and links to the alphabetical function lists
   (FUNCTIONS_01.md ...) that give, for every function, its piece and its file:line.
2. Read ONLY files from the audit-chunks branch. Do NOT read main, other branches, commit pages, patches or
   diffs, and do NOT rebuild code from commit history: older commits contain bugs that were fixed later, and a
   previous audit reported several such already-fixed bugs.
3. Each cut piece starts with a line like "[script.js lines 19343-19951 of ViewAlign fd8b8e4]". Quote code as
   file:line using the ORIGINAL line number (first line of the piece's range + offset).
4. If a function you need is not in the function lists, or a piece will not load, say "not read" for it. Never
   guess what unread code does.
5. Follow calls: before reporting that something is missing (a guard, a check, a cleanup), find the callers and
   the callees in the function lists and read them. Many guards live in the caller.

WHAT TO REPORT:
- Only defects that a user can reach. For each: ID, severity (high/medium/low), file:line, the code quoted
  exactly (copied from the piece, not retyped), the concrete input or clicks that trigger it, what happens, and
  what should happen.
- Mark each finding "verified" (you ran a faithful port on the stated input and show the output) or "read"
  (from reading only). Say which code you ported.
- Say which pieces you read in full and which you did not; findings outside what you read are not allowed.
- No style remarks, no refactoring suggestions, no "consider adding" items, no summaries of what works.
- The project rule for every fix is a test that fails before the fix and passes after: for each finding, give
  the smallest input that makes such a test fail.
---
