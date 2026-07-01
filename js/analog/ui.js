"use strict";
/* ============================================================
   analog/ui.js — app state, tab switching, palette, toolbar,
   the DC solve loop, right-click menu, value editor and the
   meter readout windows.
   ============================================================ */

if (typeof Analog === "undefined") { var Analog = {}; }

Analog.App = {
  mode: "edit", circ: null,
  view: { ox: 120, oy: 120, scale: 1 },
  selection: [], tool: null, wiring: null, hover: null, drag: null,
  result: null, meters: [], canvas: null, ctx: null, _raf: 0,
};

const AN_PALETTE = [
  { type: "DCV", label: "DC Source" },
  { type: "RES", label: "Resistor" },
  { type: "GND", label: "Ground" },
  { type: "VM", label: "Voltmeter" },
  { type: "AM", label: "Ammeter" },
];

let _anInited = false;

/* ---- tab switching ---- */
Analog.initTabs = function () {
  const bar = document.getElementById("tabbar");
  if (!bar) return;
  bar.addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    const tab = btn.dataset.tab;
    for (const b of bar.querySelectorAll(".tab")) b.classList.toggle("active", b === btn);
    document.getElementById("digitalApp").classList.toggle("hidden", tab !== "digital");
    document.getElementById("analogApp").classList.toggle("hidden", tab !== "analog");
    if (tab === "analog") { Analog.init(); Analog.resize(); Analog.requestRender(); }
  });
};

/* ---- one-time init ---- */
Analog.init = function () {
  if (_anInited) return;
  _anInited = true;
  const App = Analog.App;
  App.circ = Analog.newCircuit();
  App.canvas = document.getElementById("anCanvas");
  App.ctx = App.canvas.getContext("2d");
  Analog.buildPalette();
  Analog.bindCanvas();

  document.getElementById("anModeBtn").addEventListener("click", Analog.toggleMode);
  document.getElementById("anNewBtn").addEventListener("click", () => {
    if (App.mode === "sim") Analog.toggleMode();
    App.circ = Analog.newCircuit(); App.selection = []; App.result = null;
    for (const m of App.meters.slice()) m.el.remove(); App.meters = [];
    Analog.requestRender();
  });
  window.addEventListener("resize", () => {
    if (!document.getElementById("analogApp").classList.contains("hidden")) { Analog.resize(); Analog.requestRender(); }
  });
};

Analog.resize = function () {
  const App = Analog.App, st = document.getElementById("anStage");
  App.canvas.width = st.clientWidth;
  App.canvas.height = st.clientHeight;
};

/* ---- palette ---- */
Analog.buildPalette = function () {
  const host = document.getElementById("anPalette");
  host.innerHTML = "<h3>Components</h3>";
  for (const item of AN_PALETTE) {
    const b = document.createElement("button");
    b.className = "an-part"; b.dataset.type = item.type; b.textContent = item.label;
    b.addEventListener("click", () => {
      Analog.App.tool = Analog.App.tool === item.type ? null : item.type;
      Analog.updatePaletteSel();
    });
    host.appendChild(b);
  }
  const hint = document.createElement("p");
  hint.className = "an-hint";
  hint.innerHTML = "Click a part then click the sheet to place it. Drag terminal-to-terminal to wire. Right-click a part to change its value. Add a <b>Ground</b> for a reference.";
  host.appendChild(hint);
};
Analog.updatePaletteSel = function () {
  for (const b of document.querySelectorAll("#anPalette .an-part"))
    b.classList.toggle("active", b.dataset.type === Analog.App.tool);
};

/* ---- mode / solve ---- */
Analog.toggleMode = function () {
  const App = Analog.App;
  if (App.mode === "edit") { App.mode = "sim"; App.tool = null; Analog.updatePaletteSel(); }
  else { App.mode = "edit"; }
  document.getElementById("anModeBtn").textContent = App.mode === "sim" ? "✎ Edit" : "▶ Simulate";
  document.getElementById("anModeBtn").classList.toggle("live", App.mode === "sim");
  Analog.resolve();
  Analog.requestRender();
};

/* Re-solve the DC operating point (sim mode only) and refresh status + meters. */
Analog.resolve = function () {
  const App = Analog.App;
  App.result = App.mode === "sim" ? Analog.solveDC(App.circ) : null;
  const st = document.getElementById("anStatus");
  if (App.mode !== "sim") st.textContent = "";
  else if (!App.result.ok) { st.textContent = "⚠ " + App.result.error; st.className = "an-status err"; }
  else { st.textContent = "▶ solved"; st.className = "an-status ok"; }
  Analog.refreshMeters();
  Analog.requestRender();
};

/* ---- right-click context menu ---- */
Analog.showCtxMenu = function (c, sx, sy) {
  const menu = document.getElementById("anCtxMenu");
  const items = [];
  if (c.type === "RES" || c.type === "DCV") items.push({ label: "✎ Change value…", fn: () => Analog.editValue(c) });
  items.push({ label: "↻ Rotate 90°", fn: () => { c.rot = (c.rot + 1) & 3; Analog.resolve(); } });
  items.push({ label: "🗑 Delete", fn: () => { Analog.removeComp(Analog.App.circ, c); Analog.App.selection = []; Analog.resolve(); } });
  menu.innerHTML = "";
  for (const it of items) {
    const d = document.createElement("div"); d.className = "an-ctx-item"; d.textContent = it.label;
    d.addEventListener("click", () => { it.fn(); Analog.hideCtxMenu(); Analog.requestRender(); });
    menu.appendChild(d);
  }
  menu.style.left = sx + "px"; menu.style.top = sy + "px";
  menu.classList.remove("hidden");
};
Analog.hideCtxMenu = function () { const m = document.getElementById("anCtxMenu"); if (m) m.classList.add("hidden"); };

/* ---- value editor ---- */
function _anParse(s) {
  s = String(s).trim().replace(/Ω|ohm[s]?|V|A|F|H/gi, "").trim();
  const m = s.match(/^(-?[\d.]+)\s*([a-zA-Zµ]?)/);
  if (!m) return null;
  const n = parseFloat(m[1]); if (!isFinite(n)) return null;
  const mult = { k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, "µ": 1e-6, n: 1e-9, p: 1e-12, G: 1e9, "": 1 }[m[2]];
  return n * (mult == null ? 1 : mult);
}
Analog.editValue = function (c) {
  const unit = Analog.TYPES[c.type].unit;
  const s = prompt("Set " + Analog.TYPES[c.type].name + " value (" + unit + "). Suffixes k, M, m, µ, n allowed:",
    Analog.fmt(c.value, "").trim());
  if (s == null) return;
  const v = _anParse(s);
  if (v == null || (c.type === "RES" && v <= 0)) { alert("Couldn't read \"" + s + "\"."); return; }
  c.value = v;
  Analog.resolve(); Analog.requestRender();
};

/* ---- meter readout windows ---- */
Analog.openMeter = function (c) {
  const App = Analog.App;
  if (App.meters.find(x => x.comp === c)) return;
  const host = document.getElementById("anMeters");
  const el = document.createElement("div");
  el.className = "an-meter";
  el.innerHTML = '<div class="am-head"><span>' + Analog.TYPES[c.type].name +
    '</span><button class="am-close" title="Close">✕</button></div><div class="am-val">—</div>';
  el.style.left = (60 + App.meters.length * 22) + "px";
  el.style.top = (70 + App.meters.length * 22) + "px";
  host.appendChild(el);
  el.querySelector(".am-close").addEventListener("click", () => {
    el.remove(); App.meters = App.meters.filter(x => x.comp !== c);
  });
  _anDragWindow(el, el.querySelector(".am-head"));
  App.meters.push({ comp: c, el });
  Analog.refreshMeters();
};
Analog.refreshMeters = function () {
  const App = Analog.App;
  for (const m of App.meters) {
    const v = m.el.querySelector(".am-val");
    if (App.mode === "sim" && App.result && App.result.ok)
      v.textContent = Analog.fmt(App.result.meter(m.comp), Analog.TYPES[m.comp.type].unit);
    else v.textContent = App.result && App.result.error ? "⚠ no reading" : "— (simulate)";
  }
};
function _anDragWindow(win, handle) {
  handle.addEventListener("mousedown", e => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = win.offsetLeft, oy = win.offsetTop;
    const mv = ev => { win.style.left = ox + (ev.clientX - sx) + "px"; win.style.top = oy + (ev.clientY - sy) + "px"; };
    const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  });
}

/* boot the tab controller once the DOM is present */
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", Analog.initTabs);
else Analog.initTabs();
