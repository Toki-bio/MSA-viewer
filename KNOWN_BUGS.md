# Known bugs worth fixing later

## Ctrl+D reaches the alignment behind the Sequence editor

With the Sequence editor open and focus on one of its buttons, Ctrl+D deletes the selected columns behind the dialog. Found by the GLM audit on 2026-11-07, by reading the code; not yet reproduced in a browser.

When fixing it, block Ctrl+D alone. An existing regression check expects Ctrl+Up to keep working behind the dialog, so the editor must not block every shortcut.
