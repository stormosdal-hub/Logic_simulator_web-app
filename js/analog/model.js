"use strict";
/* ============================================================
   analog/model.js — data model for the ANALOG (electronic)
   circuit simulator: components with terminals, wires, and node
   extraction. Pure (no DOM) so it loads in headless tests.

   A separate namespaced module (`Analog`) from the digital logic
   simulator — the two apps share the shell but no globals.
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

/* ---- component catalogue ----
   Each type declares its terminals as logical (unrotated) offsets from the
   component centre. Terminal 0 is the "reference/positive" end where it
   matters (DCV +, meter probe A). `value`/`unit` drive the right-click editor. */
Analog.TYPES = {
  RES: { name: "Resistor",  terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 1000, unit: "Ω", min: 1e-3 },
  DCV: { name: "DC Source",  terminals: [{ x: 0, y: -34 }, { x: 0, y: 34 }], value: 5,    unit: "V" },
  GND: { name: "Ground",     terminals: [{ x: 0, y: -22 }],                  value: 0,    unit: "" },
  VM:  { name: "Voltmeter",  terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 0,    unit: "V", meter: true },
  AM:  { name: "Ammeter",    terminals: [{ x: -34, y: 0 }, { x: 34, y: 0 }], value: 0,    unit: "A", meter: true },
};

Analog.isMeter = function (c) { return !!(Analog.TYPES[c.type] && Analog.TYPES[c.type].meter); };

/* ---- ids / circuits ---- */
let _anUid = 1;
Analog.uid = function () { return "a" + (_anUid++); };

Analog.newCircuit = function () { return { comps: [], wires: [] }; };

Analog.makeComp = function (type, x, y, opts = {}) {
  const def = Analog.TYPES[type];
  if (!def) throw new Error("Unknown analog component: " + type);
  const c = { id: Analog.uid(), type, x, y, rot: opts.rot || 0 };
  c.value = opts.value != null ? opts.value : def.value;
  if (opts.label != null) c.label = opts.label;
  return c;
};

Analog.numTerminals = function (c) { return Analog.TYPES[c.type].terminals.length; };

/* Rotate a logical offset `rot` quarter-turns clockwise (screen space). */
function _anRot(p, rot) {
  let x = p.x, y = p.y;
  for (let i = 0; i < (rot & 3); i++) { const nx = -y, ny = x; x = nx; y = ny; }
  return { x, y };
}

/* On-screen position of terminal `i` (accounts for rotation). */
Analog.terminalPos = function (c, i) {
  const t = Analog.TYPES[c.type].terminals[i];
  const r = _anRot(t, c.rot);
  return { x: c.x + r.x, y: c.y + r.y };
};

/* Axis-aligned bounding box (for hit testing / selection). */
Analog.compBox = function (c) {
  const n = Analog.numTerminals(c);
  let minx = 0, miny = 0, maxx = 0, maxy = 0;
  for (let i = 0; i < n; i++) {
    const p = _anRot(Analog.TYPES[c.type].terminals[i], c.rot);
    minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
    maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
  }
  const pad = 16;
  return { x: c.x + minx - pad, y: c.y + miny - pad, w: (maxx - minx) + 2 * pad, h: (maxy - miny) + 2 * pad };
};

Analog.compById = function (circ, id) { return circ.comps.find(c => c.id === id); };

/* Add a wire between two terminals (endpoints are {c: compId, t: termIndex}). */
Analog.addWire = function (circ, fromComp, fromTerm, toComp, toTerm) {
  const w = { id: Analog.uid(), from: { c: fromComp.id, t: fromTerm }, to: { c: toComp.id, t: toTerm } };
  circ.wires.push(w);
  return w;
};

Analog.removeComp = function (circ, c) {
  circ.comps = circ.comps.filter(x => x !== c);
  circ.wires = circ.wires.filter(w => w.from.c !== c.id && w.to.c !== c.id);
};
Analog.removeWire = function (circ, w) { circ.wires = circ.wires.filter(x => x !== w); };

/* ---- node extraction (union-find over wired terminals) ----
   Every terminal is a graph vertex "compId:termIndex"; wires union them.
   Each connected set is one electrical node. Terminals belonging to a GND
   component collapse to the datum node (id "gnd", fixed at 0 V).

   Returns { node(compId, termIdx) -> nodeId, list, count, hasGround }
   where nodeId is "gnd" for the datum or an integer 0..count-1 otherwise. */
Analog.buildNodes = function (circ) {
  const parent = {};
  const key = (cid, t) => cid + ":" + t;
  const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  for (const c of circ.comps)
    for (let t = 0; t < Analog.numTerminals(c); t++) { const k = key(c.id, t); parent[k] = k; }
  for (const w of circ.wires) {
    if (parent[key(w.from.c, w.from.t)] === undefined || parent[key(w.to.c, w.to.t)] === undefined) continue;
    union(key(w.from.c, w.from.t), key(w.to.c, w.to.t));
  }

  // which roots are ground?
  const groundRoots = new Set();
  let hasGround = false;
  for (const c of circ.comps)
    if (c.type === "GND") { hasGround = true; groundRoots.add(find(key(c.id, 0))); }

  // assign integer ids to non-ground roots
  const rootId = {};
  let count = 0;
  const nodeOf = (cid, t) => {
    const r = find(key(cid, t));
    if (groundRoots.has(r)) return "gnd";
    if (!(r in rootId)) rootId[r] = count++;
    return rootId[r];
  };
  // materialise for every terminal
  const map = {};
  for (const c of circ.comps)
    for (let t = 0; t < Analog.numTerminals(c); t++) map[key(c.id, t)] = nodeOf(c.id, t);

  return { map, key, count, hasGround, nodeAt: (cid, t) => map[key(cid, t)] };
};

if (typeof module !== "undefined" && module.exports) module.exports = Analog;
