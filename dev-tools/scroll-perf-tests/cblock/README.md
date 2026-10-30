Canvas Block prototype (branch proto-canvas-block): checks and measurements.
Run from this folder with NODE_PATH pointing at a node_modules that has playwright-core:
  node gen_fixtures.js .          # aln600x600, mito62x16808, aln2000x2000, small25x800 (.fas, not committed)
  node check.js                   # interaction, pixel parity with Canvas, frame copy == full redraw
  node measure.js aln600x600.fas  # DOM Block vs Canvas vs Canvas Block: scroll frames, switch, resize, bar drag
  node drag.js                    # selection drag across blocks, DOM Block vs Canvas Block
Open the prototype: index.html?view=cblock (or window.vaCanvasBlock(true) in the console).
