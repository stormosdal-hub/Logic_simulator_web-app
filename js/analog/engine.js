"use strict";
/* ============================================================
   analog/engine.js — DC simulation via Modified Nodal Analysis.

   Build the system  A·x = z  where x = [ node voltages … ,
   voltage-source branch currents … ] and solve it directly
   (Gaussian elimination). Pure resistive DC is linear, so one
   solve is exact — no time-stepping, no iteration.

   Stamps:
     • Resistor (g = 1/R) between nodes a,b — the conductance stamp.
     • Voltage source (DC source; ammeter = 0 V source) — adds a
       branch-current unknown and the constraint  V(a) − V(b) = E.
     • Voltmeter — ideal open circuit: not stamped, just probed.
     • Ground — the datum node, fixed at 0 V (never an unknown).
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

Analog.Sim = { active: false, running: false, result: null };

/* Solve A·x = z in place (Gauss-Jordan, partial pivoting). Returns x, or
   null if the matrix is singular (floating node / unsolvable circuit). */
function _anSolve(A, z) {
  const n = z.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;   // singular
    if (piv !== col) { const tA = A[piv]; A[piv] = A[col]; A[col] = tA; const tz = z[piv]; z[piv] = z[col]; z[col] = tz; }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      if (!f) continue;
      for (let cc = col; cc < n; cc++) A[r][cc] -= f * A[col][cc];
      z[r] -= f * z[col];
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = z[i] / A[i][i];
  return x;
}

/* Solve the analog circuit's DC operating point.
   Returns a result object:
     { ok, error?, nodes, volt(cid,t), meter(comp), node voltages, branch currents } */
Analog.solveDC = function (circ) {
  const nodes = Analog.buildNodes(circ);
  if (!nodes.hasGround)
    return { ok: false, error: "Add a Ground — the circuit needs a 0 V reference." };

  const vi = id => (id === "gnd" ? -1 : id);           // matrix index of a node (−1 = datum)
  const n = nodes.count;

  // voltage sources (DC sources + ammeters, which are 0 V sources) get a branch unknown
  const vsrc = [];
  for (const c of circ.comps) {
    if (c.type === "DCV") vsrc.push({ comp: c, p: nodes.nodeAt(c.id, 0), q: nodes.nodeAt(c.id, 1), E: c.value });
    else if (c.type === "AM") vsrc.push({ comp: c, p: nodes.nodeAt(c.id, 0), q: nodes.nodeAt(c.id, 1), E: 0 });
  }
  const m = vsrc.length;
  const sz = n + m;

  const volt = (cid, t) => { const id = nodes.nodeAt(cid, t); return id === "gnd" ? 0 : null; };

  if (sz === 0) {
    // nothing but ground (or empty): every node is 0 V
    const res = { ok: true, nodes, nodeV: [], branchI: [], vsrc, _v: {} };
    res.volt = (cid, t) => { const id = nodes.nodeAt(cid, t); return id === "gnd" ? 0 : 0; };
    res.meter = c => 0;
    return res;
  }

  const A = Array.from({ length: sz }, () => new Array(sz).fill(0));
  const z = new Array(sz).fill(0);

  const stampG = (a, b, g) => {
    if (a >= 0) A[a][a] += g;
    if (b >= 0) A[b][b] += g;
    if (a >= 0 && b >= 0) { A[a][b] -= g; A[b][a] -= g; }
  };

  for (const c of circ.comps) {
    if (c.type === "RES") {
      const R = Math.max(c.value, Analog.TYPES.RES.min);
      stampG(vi(nodes.nodeAt(c.id, 0)), vi(nodes.nodeAt(c.id, 1)), 1 / R);
    }
  }
  vsrc.forEach((s, k) => {
    const row = n + k, p = vi(s.p), q = vi(s.q);
    if (p >= 0) { A[p][row] += 1; A[row][p] += 1; }
    if (q >= 0) { A[q][row] -= 1; A[row][q] -= 1; }
    z[row] = s.E;
  });

  const x = _anSolve(A, z);
  if (!x)
    return { ok: false, error: "Circuit can't be solved — check for a floating section or a short across a source." };

  const nodeVolt = id => (id === "gnd" ? 0 : x[id]);
  const branchI = k => x[n + k];   // current from terminal 0 → terminal 1 of vsrc k

  const res = { ok: true, nodes, x, n, vsrc };
  res.volt = (cid, t) => nodeVolt(nodes.nodeAt(cid, t));
  res.meter = function (c) {
    if (c.type === "VM") return nodeVolt(nodes.nodeAt(c.id, 0)) - nodeVolt(nodes.nodeAt(c.id, 1));
    if (c.type === "AM") { const k = vsrc.findIndex(s => s.comp === c); return k < 0 ? 0 : branchI(k); }
    return 0;
  };
  // current through a resistor (terminal 0 → 1), handy for display/colouring
  res.current = function (c) {
    if (c.type === "RES") {
      const R = Math.max(c.value, Analog.TYPES.RES.min);
      return (nodeVolt(nodes.nodeAt(c.id, 0)) - nodeVolt(nodes.nodeAt(c.id, 1))) / R;
    }
    if (c.type === "AM") { const k = vsrc.findIndex(s => s.comp === c); return k < 0 ? 0 : branchI(k); }
    return 0;
  };
  return res;
};

/* Format a value with an SI prefix and unit (e.g. 1500 Ω → "1.5 kΩ"). */
Analog.fmt = function (v, unit) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  let s = v, p = "";
  if (a >= 1e9)      { s = v / 1e9;  p = "G"; }
  else if (a >= 1e6) { s = v / 1e6;  p = "M"; }
  else if (a >= 1e3) { s = v / 1e3;  p = "k"; }
  else if (a === 0)  { s = 0;        p = "";  }
  else if (a < 1e-6) { s = v / 1e-9; p = "n"; }
  else if (a < 1e-3) { s = v / 1e-6; p = "µ"; }
  else if (a < 1)    { s = v / 1e-3; p = "m"; }
  const r = Math.abs(s) >= 100 ? s.toFixed(0) : Math.abs(s) >= 10 ? s.toFixed(1) : s.toFixed(2);
  return parseFloat(r) + " " + p + (unit || "");
};

if (typeof module !== "undefined" && module.exports) module.exports = Analog;
