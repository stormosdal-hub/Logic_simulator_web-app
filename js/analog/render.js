"use strict";
/* ============================================================
   analog/render.js — canvas drawing for the analog simulator.
   Schematic symbols (resistor, source, ground, meters), wires,
   terminals, selection, and live values in sim mode.
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

Analog.GRID = 20;
Analog.snap = v => Math.round(v / Analog.GRID) * Analog.GRID;

/* view transform helpers */
Analog.screenToWorld = function (sx, sy) {
  const v = Analog.App.view;
  return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale };
};

/* map a node voltage to a wire colour (grey at 0 V, warmer as it rises) */
function _anVColor(v) {
  if (v == null || !isFinite(v)) return "#7a8699";
  const t = Math.max(-1, Math.min(1, v / 12));
  if (t >= 0) { const g = Math.round(120 - 60 * t), b = Math.round(120 - 100 * t); return `rgb(230,${g},${b})`; }
  const r = Math.round(120 + 110 * t); return `rgb(${r},150,235)`;
}

Analog.requestRender = function () {
  if (Analog.App && Analog.App._raf) return;
  Analog.App._raf = requestAnimationFrame(() => { Analog.App._raf = 0; Analog.render(); });
};

Analog.render = function () {
  const App = Analog.App, cv = App.canvas, g = App.ctx;
  if (!cv || !g) return;
  const W = cv.width, H = cv.height, sim = App.mode === "sim";
  const res = sim ? App.result : null;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#0f1420";
  g.fillRect(0, 0, W, H);

  const v = App.view;
  g.setTransform(v.scale, 0, 0, v.scale, v.ox, v.oy);

  // grid
  const x0 = -v.ox / v.scale, y0 = -v.oy / v.scale, x1 = x0 + W / v.scale, y1 = y0 + H / v.scale;
  g.fillStyle = "#1b2436";
  const G = Analog.GRID;
  for (let x = Math.floor(x0 / G) * G; x < x1; x += G)
    for (let y = Math.floor(y0 / G) * G; y < y1; y += G) g.fillRect(x - 0.5, y - 0.5, 1, 1);

  // wires
  g.lineWidth = 3; g.lineCap = "round";
  for (const w of App.circ.wires) {
    const a = _endPos(App.circ, w.from), b = _endPos(App.circ, w.to);
    if (!a || !b) continue;
    g.strokeStyle = sim && res && res.ok ? _anVColor(res.volt(w.from.c, w.from.t)) : "#8aa0c0";
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }

  // components
  for (const c of App.circ.comps) _drawComp(g, c, sim, res);

  // terminals
  for (const c of App.circ.comps)
    for (let t = 0; t < Analog.numTerminals(c); t++) {
      const p = Analog.terminalPos(c, t);
      const hov = App.hover && App.hover.c === c.id && App.hover.t === t;
      g.beginPath(); g.arc(p.x, p.y, hov ? 6 : 3.5, 0, 7);
      g.fillStyle = hov ? "#ffd166" : "#4a5a75"; g.fill();
    }

  // selection outline
  g.lineWidth = 1.5; g.strokeStyle = "#4f8cff";
  for (const c of App.selection) { const b = Analog.compBox(c); g.strokeRect(b.x, b.y, b.w, b.h); }

  // wiring rubber-band
  if (App.wiring) {
    const s = Analog.terminalPos(Analog.compById(App.circ, App.wiring.c), App.wiring.t);
    g.strokeStyle = "#ffd166"; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(App.wiring.x, App.wiring.y); g.stroke();
  }
};

function _endPos(circ, e) { const c = Analog.compById(circ, e.c); return c ? Analog.terminalPos(c, e.t) : null; }

function _drawComp(g, c, sim, res) {
  const def = Analog.TYPES[c.type];
  g.save();
  g.translate(c.x, c.y);
  g.rotate((c.rot & 3) * Math.PI / 2);
  g.lineWidth = 2.5; g.strokeStyle = "#cdd8ea"; g.fillStyle = "#0f1420";
  g.lineCap = "round";

  if (c.type === "RES") {
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-24, 0); g.moveTo(24, 0); g.lineTo(34, 0); g.stroke();
    g.beginPath(); g.rect(-24, -9, 48, 18); g.fillStyle = "#182338"; g.fill(); g.stroke();
  } else if (c.type === "DCV") {
    g.beginPath(); g.moveTo(0, -34); g.lineTo(0, -10); g.moveTo(0, 10); g.lineTo(0, 34); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(-14, -10); g.lineTo(14, -10); g.stroke();          // + long plate
    g.beginPath(); g.moveTo(-7, 10); g.lineTo(7, 10); g.stroke();              // − short plate
    g.fillStyle = "#9fb3d0"; g.font = "12px sans-serif"; g.textAlign = "center";
    g.fillText("+", 22, -8);
  } else if (c.type === "GND") {
    g.beginPath(); g.moveTo(0, -22); g.lineTo(0, -8); g.stroke();
    g.beginPath();
    g.moveTo(-12, -8); g.lineTo(12, -8); g.moveTo(-8, -3); g.lineTo(8, -3); g.moveTo(-4, 2); g.lineTo(4, 2);
    g.stroke();
  } else if (c.type === "VM" || c.type === "AM") {
    g.beginPath(); g.moveTo(-34, 0); g.lineTo(-16, 0); g.moveTo(16, 0); g.lineTo(34, 0); g.stroke();
    g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fillStyle = "#182338"; g.fill(); g.stroke();
    g.fillStyle = "#ffd166"; g.font = "bold 15px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(c.type === "VM" ? "V" : "A", 0, 1);
  }
  g.restore();

  // upright value / reading label
  const box = Analog.compBox(c);
  g.fillStyle = "#9fb3d0"; g.font = "12px sans-serif"; g.textAlign = "center"; g.textBaseline = "top";
  let label = "";
  if (c.type === "RES") label = Analog.fmt(c.value, "Ω");
  else if (c.type === "DCV") label = Analog.fmt(c.value, "V");
  else if (c.type === "VM" || c.type === "AM") {
    label = def.name;
    if (sim && res && res.ok) { g.fillStyle = "#ffd166"; label = Analog.fmt(res.meter(c), def.unit); }
  }
  if (label) g.fillText(label, c.x, box.y + box.h + 2);
}
