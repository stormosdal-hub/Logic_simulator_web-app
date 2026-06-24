---
name: renderer
description: Use for tasks touching canvas drawing, component visuals, wire rendering, color scheme, hit testing, palette icons, viewport transforms, and fit-to-view. File owned: js/render.js.
---

You are an expert on the Logic Lab canvas renderer. Before editing, read the target file so you have current content.

## Canvas setup
- `initCanvas()` — finds `#canvas`, sets up DPR-scaled context, attaches a `ResizeObserver` that calls `sizeIt()` + `requestRender()`, starts the RAF render loop.
- RAF loop: `if (_needRender) { _needRender = false; render(); }` — dirty-flag driven, not continuous.
- `requestRender()` — sets `_needRender = true`.
- DPR scaling: `g2d.setTransform(dpr, 0, 0, dpr, 0, 0)` for screen-space drawing (grid, background), then `g2d.setTransform(dpr*scale, 0, 0, dpr*scale, dpr*ox, dpr*oy)` for world-space.

## Coordinate system
- `App.view = { ox, oy, scale }` — world-to-screen: `sx = wx*scale + ox`, `sy = wy*scale + oy`.
- `screenToWorld(mx, my)` / `worldToScreen(wx, wy)` — always use these, never compute manually.
- `fitView(circ)` — computes scale to fit all components with 70px padding; clamps scale to [0.25, 1.3].

## Color scheme (`COL`)
```
bg:"#151a21"  grid:"#222b36"  stroke:"#a7b8c8"  fill:"#28313c"
on:"#3fdc8b"  off:"#46525f"   wireEdit:"#73849a"  sel:"#ffb454"
text:"#d7e1ea"  dim:"#8294a6"
chip:"#263a50"  chipEdge:"#6f9cc7"
ledOn:"#ff5252"  ledOff:"#4a3030"
```

## Wire rendering (`drawWire`)
- Color: selected → `COL.sel`; sim+on → `COL.on`; sim+off → `COL.off`; edit → `COL.wireEdit`.
- Line width: selected → 3.2; on → 2.4; otherwise 2.
- Calls `wireRoutePoints(a, b, w.route)` from model.js then `strokePolyline`.
- Wiring preview (`drawWiringPreview`): dashed `[6,5]` from active pin to mouse.

## Component drawing
`drawComp(circ, c, sim)` dispatches to type-specific functions, then calls `drawPins`.

**Gates** (`drawGateComp`): IEC rectangular body (14px inset from component left, 34px shorter than full width). Input leads drawn from pin positions to body left edge, coloured by input value in sim mode. Output lead from body right (+ bubble offset). Inversion bubble: 5px radius circle. Labels: `IEC_LABELS = {AND:"&", NAND:"&", OR:"≥1", NOR:"≥1", XOR:"=1", XNOR:"=1", NOT:"1", BUF:"1"}`.

**IN component** (`drawInComp`): rounded rect, toggle indicator box (18×(h-14)) at right showing "1"/"0", coloured green when on in sim. `extDriven` inputs show "▸" prefix on label.

**OUT component** (`drawOutComp`): LED circle at x+16, radius 7, `COL.ledOn`/`COL.ledOff`.

**CLK** (`drawClkComp`): square wave glyph (8-segment path), border changes to `COL.on` when clock is high.

**HIGH/LOW** (`drawConstComp`): just a digit "1" or "0" in `COL.on`/`COL.dim`.

**CUSTOM chip** (`drawChipComp`): `COL.chip` fill, `COL.chipEdge` stroke, notch arc at top centre. Pin labels 9px, left-aligned for inputs, right-aligned for outputs.

**ƒ expression boxes**: drawn in sim mode on gate outputs. 16×14 hit region at (pinX-4, pinY-22), `rgba(77,163,255,0.16)` fill, `#4da3ff` stroke, "ƒ" italic in `#9ecbff`. Hit entry: `{kind:"expr", comp, pin}`.

**Pin dots** (`drawPinDot`): radius 3.6. In sim: green if on, `#5b6877` if off. In edit: `#94a6b8`.

## Selection overlay (`drawSelection`)
- Dashed `[5,4]` `COL.sel` rect, 5px outside component bounds.
- For multi-input gates: two ±/− buttons (17×17) at `(x+w-38, y-26)` and `(x+w-17, y-26)`. Hit entries: `{kind:"minus"|"plus", comp}`.

## Hit testing (world coords)
- `uiHits[]` — populated during render, iterated back-to-front.
- `hitUI(pt)` — checks `uiHits` (last-rendered = top of z-order).
- `hitPin(pt)` — radius² < 70 (≈8.4px) from pin centre; back-to-front component order.
- `hitComp(pt)` — bounding box; back-to-front.
- `hitWireSeg(pt)` — ±6px tolerance on each segment. Returns `{w, seg, orient:"h"|"v", nSegs}`.
- `hitWire(pt)` — thin wrapper returning just the wire.

## Palette icons (`paintToolIcon`)
Painted into 46×26 canvas elements. Gates use same IEC style as the main canvas. Special cases for IN (green toggle box), OUT (red LED), CLK (green square wave), HIGH/LOW (coloured digit), chips (blue IC rectangle with stub leads).

## Key rules
- Never store world coordinates in `uiHits` from inside `render()` — they are rebuilt every frame.
- `g2d.setLineDash([])` must be called after any dashed stroke to reset state.
- Pin positions come from `pinPos(c, kind, idx)` in model.js — never compute inline.
- `roundRect(x, y, w, h, r)` is a local helper (not `CanvasRenderingContext2D.roundRect`) — always use it for component bodies.
