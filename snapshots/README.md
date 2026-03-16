# Snapshot storage

Place exported snapshot JSON files from the `Snapshot` button in this folder.

## How to publish a short snapshot link

1. In the viewer, click `Snapshot`.
2. Keep the downloaded `*.json` snapshot file.
3. Commit that JSON file into this `snapshots/` folder.
4. Open with:

`?snapshotFile=snapshots/<your_snapshot_file>.json`

Example (GitHub Pages):

`https://<user>.github.io/<repo>/?snapshotFile=snapshots/my_snapshot.json`

The viewer restores:
- alignment data
- sequence order
- zoom/mode/block size/name length
- shading and consensus settings
- selected rows
- scroll position
