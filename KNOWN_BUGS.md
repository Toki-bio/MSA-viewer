# Known bugs worth fixing later

None listed at the moment. The open findings of the 2026-11-10 audit are in
docs/sessions/2026-11-10-audit-HANDOFF.md.

Fixed 2026-11-10 (v332): Ctrl+D reached the alignment behind the Sequence editor. The alignment's shortcuts now do
nothing while a dialog is open, while focus is inside a window, or while a job runs (regression check "Audit H3").
