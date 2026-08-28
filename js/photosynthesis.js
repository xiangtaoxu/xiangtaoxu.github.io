/*
  photosynthesis.js -- the interactive Photosynthesis page for BioEE 1610.

  All physics lives in photosynthesis-model.js (a verified port of MEDS v0.1.0); this
  file only draws and wires. Three panels, each mounting into empty divs the .qmd owns:

    #ph-limits-*    section 1 -- FvCB demand at a PRESCRIBED Ci. No stomata, no solver.
    #ph-water-*     section 2 -- + Medlyn stomata, so carbon now costs water.
    #ph-pathways-*  section 3 -- + a simulated day, and C3 / C4 / CAM compared over it.

  Each panel adds exactly one layer of complexity to the one before, which is why the
  Ci control in section 1 becomes a Ca control in section 2: a real leaf cannot set its
  own internal CO2, and noticing that is the point of the transition.

  Every colour is a CSS class in theme.scss, never an inline attribute.
  No build step, no bundler, no dependencies.
*/

(function () {
  "use strict";

  var M = window.PhotoModel;
  if (!M) return;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var N = 120;                      // points per curve on the continuous charts
  var DAY_STEPS = 96;               // 15-minute diurnal resolution (see the model file)

  // ------------------------------------------------------------- small helpers

  function el(name, attrs, text) {
    var e = document.createElementNS(SVG_NS, name), k;
    for (k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function fmt(x, d) { return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }

  function niceTicks(lo, hi, want) {
    var span = hi - lo;
    if (!(span > 0)) return [lo];
    var raw = span / (want || 5);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var out = [], t = Math.ceil(lo / step) * step;
    for (; t <= hi + step * 1e-9; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
    return out;
  }

  // ------------------------------------------------------------- chart builder

  /* A minimal x/y line chart. Data coordinates in, <svg> out.

     Everything on the page is a line series against a numeric x, so one builder serves
     all three sections; the only real variation is a second y axis (section 2 and 3's
     day view) and the shaded bands section 1 uses to show what is limiting. */
  function chart(opt) {
    var W = opt.width || 640, H = opt.height || 300;
    var m = opt.margin || { top: 18, right: 58, bottom: 44, left: 60 };
    var pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    var xd = opt.xDomain, yd = opt.yDomain, y2d = opt.y2Domain;
    var layers = { bands: [], grid: [], series: [], marks: [], labels: [] };

    function X(v) { return m.left + (v - xd[0]) / (xd[1] - xd[0]) * pw; }
    function Y(v) { return m.top + ph - (v - yd[0]) / (yd[1] - yd[0]) * ph; }
    function Y2(v) { return m.top + ph - (v - y2d[0]) / (y2d[1] - y2d[0]) * ph; }

    var api = {
      x: X, y: Y, y2: Y2, plotW: pw, plotH: ph, margin: m,

      band: function (o) {
        var x0 = X(Math.max(o.x0, xd[0])), x1 = X(Math.min(o.x1, xd[1]));
        if (x1 - x0 < 0.5) return api;
        layers.bands.push(el("rect", { x: x0, y: m.top, width: x1 - x0, height: ph,
                                       "class": "ph-band ph-band-" + o.cls }));
        if (o.label && x1 - x0 > 54) {
          layers.labels.push(el("text", { x: (x0 + x1) / 2, y: m.top + 13,
                                          "class": "ph-band-label" }, o.label));
        }
        return api;
      },

      series: function (o) {
        var map = o.axis === "y2" ? Y2 : Y, d = "", started = false;
        for (var i = 0; i < o.points.length; i++) {
          var p = o.points[i];
          if (p[1] == null || !isFinite(p[1])) { started = false; continue; }
          var yy = Math.max(m.top - 4, Math.min(m.top + ph + 4, map(p[1])));
          d += (started ? "L" : "M") + fmt(X(p[0]), 1) + "," + fmt(yy, 1);
          started = true;
        }
        if (d) layers.series.push(el("path", { d: d, "class": "ph-line " + o.cls }));
        return api;
      },

      marker: function (o) {
        layers.marks.push(el("line", { x1: X(o.x), x2: X(o.x), y1: m.top, y2: m.top + ph,
                                       "class": "ph-cursor" }));
        return api;
      },

      dot: function (o) {
        var map = o.axis === "y2" ? Y2 : Y;
        layers.marks.push(el("circle", { cx: X(o.x), cy: map(o.y), r: o.r || 3.5,
                                         "class": "ph-dot " + (o.cls || "") }));
        return api;
      },

      note: function (o) {
        layers.labels.push(el("text", { x: X(o.x), y: (o.axis === "y2" ? Y2 : Y)(o.y) + (o.dy || 0),
                                        "class": "ph-note", "text-anchor": o.anchor || "middle" },
                              o.text));
        return api;
      },

      render: function () {
        var svg = el("svg", {
          viewBox: "0 0 " + W + " " + H, "class": "ph-chart",
          role: "img", "aria-label": opt.ariaLabel || ""
        });
        var i, t, ticks;

        layers.bands.forEach(function (b) { svg.appendChild(b); });

        // gridlines + left axis ticks
        ticks = opt.yTicks || niceTicks(yd[0], yd[1], 5);
        for (i = 0; i < ticks.length; i++) {
          t = ticks[i];
          svg.appendChild(el("line", { x1: m.left, x2: m.left + pw, y1: Y(t), y2: Y(t),
            "class": t === 0 ? "ph-axis-zero" : "ph-gridline" }));
          svg.appendChild(el("text", { x: m.left - 8, y: Y(t) + 4, "class": "ph-tick ph-tick-y" },
                             opt.yTickFmt ? opt.yTickFmt(t) : String(t)));
        }
        // right axis
        if (y2d) {
          ticks = opt.y2Ticks || niceTicks(y2d[0], y2d[1], 5);
          for (i = 0; i < ticks.length; i++) {
            t = ticks[i];
            svg.appendChild(el("text", { x: m.left + pw + 8, y: Y2(t) + 4,
              "class": "ph-tick ph-tick-y2" }, opt.y2TickFmt ? opt.y2TickFmt(t) : String(t)));
          }
        }
        // x axis
        ticks = opt.xTicks || niceTicks(xd[0], xd[1], 6);
        for (i = 0; i < ticks.length; i++) {
          t = ticks[i];
          svg.appendChild(el("line", { x1: X(t), x2: X(t), y1: m.top + ph, y2: m.top + ph + 5,
            "class": "ph-axis" }));
          svg.appendChild(el("text", { x: X(t), y: m.top + ph + 19, "class": "ph-tick ph-tick-x" },
                             opt.xTickFmt ? opt.xTickFmt(t) : String(t)));
        }
        svg.appendChild(el("line", { x1: m.left, x2: m.left + pw, y1: m.top + ph, y2: m.top + ph,
                                     "class": "ph-axis" }));

        layers.series.forEach(function (s) { svg.appendChild(s); });
        layers.marks.forEach(function (s) { svg.appendChild(s); });
        layers.labels.forEach(function (s) { svg.appendChild(s); });

        // axis titles
        svg.appendChild(el("text", { x: m.left + pw / 2, y: H - 4, "class": "ph-axis-title" },
                           opt.xLabel));
        svg.appendChild(el("text", { x: 0, y: 0, "class": "ph-axis-title",
          transform: "translate(13," + (m.top + ph / 2) + ") rotate(-90)" }, opt.yLabel));
        if (opt.y2Label) {
          svg.appendChild(el("text", { x: 0, y: 0, "class": "ph-axis-title ph-axis-title-2",
            transform: "translate(" + (W - 10) + "," + (m.top + ph / 2) + ") rotate(-90)" },
            opt.y2Label));
        }
        return svg;
      }
    };
    return api;
  }

  // ------------------------------------------------------------- control widgets

  function slider(o) {
    var wrap = h("label", "ph-field");
    var head = h("span", "ph-field-head");
    head.appendChild(h("span", "ph-field-name", o.label));
    var val = h("span", "ph-field-value");
    head.appendChild(val);
    wrap.appendChild(head);
    var input = document.createElement("input");
    input.type = "range";
    input.min = o.min; input.max = o.max; input.step = o.step; input.value = o.value;
    input.setAttribute("aria-label", o.aria || o.label);
    wrap.appendChild(input);
    if (o.hint) wrap.appendChild(h("span", "ph-field-hint", o.hint));
    function show() {
      val.textContent = (o.fmt ? o.fmt(+input.value) : input.value) + (o.unit ? " " + o.unit : "");
      input.setAttribute("aria-valuetext", val.textContent);
    }
    show();
    input.addEventListener("input", function () { show(); o.onInput(+input.value); });
    return { node: wrap, input: input, set: function (v) { input.value = v; show(); } };
  }

  function chooser(o) {
    var wrap = h("label", "ph-field");
    wrap.appendChild(h("span", "ph-field-name", o.label));
    var sel = document.createElement("select");
    sel.setAttribute("aria-label", o.label);
    o.options.forEach(function (opt) {
      var e = document.createElement("option");
      e.value = opt.value; e.textContent = opt.label;
      sel.appendChild(e);
    });
    sel.value = o.value;
    sel.addEventListener("change", function () { o.onChange(sel.value); });
    wrap.appendChild(sel);
    return { node: wrap, select: sel, set: function (v) { sel.value = v; } };
  }

  // A labelled group of radio buttons, used where a choice changes what the chart MEANS
  // and so must be visible rather than hidden in a menu.
  function switcher(o) {
    var wrap = h("div", "ph-field ph-switch" + (o.emphasis ? " ph-switch-key" : ""));
    if (o.label) wrap.appendChild(h("span", "ph-field-name", o.label));
    var row = h("div", "ph-switch-row");
    var name = "sw" + Math.random().toString(36).slice(2, 8);
    o.options.forEach(function (opt) {
      var lab = h("label", "ph-switch-opt");
      var r = document.createElement("input");
      r.type = "radio"; r.name = name; r.value = opt.value;
      if (opt.value === o.value) r.checked = true;
      r.addEventListener("change", function () { if (r.checked) o.onChange(opt.value); });
      lab.appendChild(r);
      lab.appendChild(h("span", null, opt.label));
      row.appendChild(lab);
    });
    wrap.appendChild(row);
    if (o.hint) wrap.appendChild(h("span", "ph-field-hint", o.hint));
    return { node: wrap };
  }

  function toggles(o) {
    var wrap = h("div", "ph-field");
    wrap.appendChild(h("span", "ph-field-name", o.label));
    var row = h("div", "ph-switch-row");
    o.options.forEach(function (opt) {
      var lab = h("label", "ph-switch-opt ph-toggle-" + opt.value);
      var c = document.createElement("input");
      c.type = "checkbox"; c.checked = opt.checked !== false;
      c.addEventListener("change", function () { o.onChange(opt.value, c.checked); });
      lab.appendChild(c);
      lab.appendChild(h("span", null, opt.label));
      row.appendChild(lab);
    });
    wrap.appendChild(row);
    return { node: wrap };
  }

  function tabs(host, items, onPick) {
    var bar = h("div", "ph-tabs");
    var btns = items.map(function (it, i) {
      var b = h("button", "ph-tab" + (i === 0 ? " is-active" : ""), it.label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", i === 0 ? "true" : "false");
      b.addEventListener("click", function () {
        btns.forEach(function (o, j) {
          o.classList.toggle("is-active", j === i);
          o.setAttribute("aria-selected", j === i ? "true" : "false");
        });
        onPick(it.key);
      });
      bar.appendChild(b);
      return b;
    });
    bar.setAttribute("role", "tablist");
    host.appendChild(bar);
  }

  // A collapsed <details> holding the plotted series as a table: the screen-reader path,
  // and what a student pastes into a spreadsheet for a lab report.
  function dataTable(caption, headers, rows) {
    var d = h("details", "ph-data");
    d.appendChild(h("summary", null, "Show these numbers as a table"));
    var wrap = h("div", "ph-table-wrap");
    var t = h("table", "ph-table");
    var html = "<caption>" + caption + "</caption><thead><tr>";
    headers.forEach(function (x) { html += "<th scope=\"col\">" + x + "</th>"; });
    html += "</tr></thead><tbody>";
    rows.forEach(function (r) {
      html += "<tr>";
      r.forEach(function (c, i) { html += i === 0 ? "<th scope=\"row\">" + c + "</th>" : "<td>" + c + "</td>"; });
      html += "</tr>";
    });
    t.innerHTML = html + "</tbody>";
    wrap.appendChild(t);
    d.appendChild(wrap);
    return d;
  }

  // Redraw on the next frame, never more than once per frame. A dragged slider fires
  // `input` faster than the display refreshes; without this the work queues up.
  function scheduler(fn) {
    var pending = false;
    return function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; fn(); });
    };
  }

  // ========================================================================
  //  SECTION 1 -- What limits a leaf?   (demand only: you set Ci)
  // ========================================================================

  var limits = {
    state: { presetKey: "sun", ci: 280, vcmax25: 90, jv: 1.8, rdv: 0.015, tempC: 25,
             par: 1500, view: "light" },
    ref: null,

    boot: function () {
      var host = document.getElementById("ph-limits-controls");
      if (!host) return;
      this.chartHost = document.getElementById("ph-limits-chart");
      this.readHost = document.getElementById("ph-limits-readout");
      this.draw = scheduler(this.render.bind(this));
      this.buildControls(host);
      this.snapshotReference();
      this.render();
    },

    params: function () {
      var s = this.state;
      return M.params({ preset: s.presetKey === "custom" ? "sun" : s.presetKey,
                        pathway: "C3", vcmax25: s.vcmax25, jvRatio: s.jv, rdRatio: s.rdv,
                        jmax25: null, tpu25: null, rd25: null });
    },

    // The grey "where you started" curve. Captured from the preset, not from the live
    // sliders, so a slider move always reads as a change from a fixed baseline.
    snapshotReference: function () {
      var p = M.params({ preset: this.state.presetKey === "custom" ? "sun" : this.state.presetKey });
      var rates = M.scaleRates(p, 25);
      var pts = [], i, par;
      for (i = 0; i <= N; i++) {
        par = i / N * 2000;
        pts.push([par, M.demandC3(280, rates, par, true).An]);
      }
      this.ref = pts;
    },

    buildControls: function (host) {
      var self = this, s = this.state;
      host.innerHTML = "";

      tabs(host, [{ key: "light", label: "Response to light" },
                  { key: "aci",   label: "Response to CO₂ inside the leaf" }],
           function (k) { s.view = k; self.render(); });

      var grid = h("div", "ph-controls-grid");

      this.presetSel = chooser({
        label: "Kind of leaf", value: s.presetKey,
        options: M.PRESETS.filter(function (p) { return p.pathway === "C3"; })
                          .map(function (p) { return { value: p.key, label: p.name }; }),
        onChange: function (v) {
          s.presetKey = v;
          var p = M.preset(v);
          s.vcmax25 = p.vcmax25; s.jv = p.jvRatio; s.rdv = p.rdRatio;
          self.vc.set(p.vcmax25); self.jvS.set(p.jvRatio); self.rdS.set(p.rdRatio);
          self.snapshotReference();
          self.render();
        }
      });
      grid.appendChild(this.presetSel.node);

      this.ciS = slider({
        label: "CO₂ inside the leaf (Ci)", value: s.ci, min: 50, max: 1000, step: 5, unit: "ppm",
        hint: "A real leaf usually sits near 70 % of the outside air — about 280 ppm when the air is 400.",
        aria: "Intercellular CO2 concentration in parts per million",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.ci = v; self.draw(); }
      });
      grid.appendChild(this.ciS.node);

      this.parS = slider({
        label: "Sunlight (PAR)", value: s.par, min: 0, max: 2000, step: 10,
        unit: "µmol/m²/s", aria: "Photosynthetically active radiation",
        hint: "Full summer sun ≈ 2000 · overcast ≈ 400 · forest floor ≈ 50",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.par = v; self.draw(); }
      });
      grid.appendChild(this.parS.node);

      this.tempS = slider({
        label: "Leaf temperature", value: s.tempC, min: 0, max: 45, step: 0.5, unit: "°C",
        aria: "Leaf temperature in degrees Celsius",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tempC = v; self.draw(); }
      });
      grid.appendChild(this.tempS.node);

      this.vc = slider({
        label: "Rubisco capacity (Vcmax25)", value: s.vcmax25, min: 10, max: 150, step: 1,
        unit: "µmol/m²/s", aria: "Maximum carboxylation rate at 25 degrees Celsius",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.vcmax25 = v; s.presetKey = "custom"; self.presetSel.set("custom"); self.draw(); }
      });
      grid.appendChild(this.vc.node);

      this.jvS = slider({
        label: "Electron transport : Rubisco (Jmax/Vcmax)", value: s.jv, min: 1.0, max: 2.5, step: 0.05,
        aria: "Ratio of maximum electron transport to maximum carboxylation",
        fmt: function (v) { return fmt(v, 2); },
        onInput: function (v) { s.jv = v; s.presetKey = "custom"; self.presetSel.set("custom"); self.draw(); }
      });
      grid.appendChild(this.jvS.node);

      this.rdS = slider({
        label: "Respiration : Rubisco (Rd/Vcmax)", value: s.rdv, min: 0.005, max: 0.03, step: 0.001,
        aria: "Ratio of dark respiration to maximum carboxylation",
        fmt: function (v) { return fmt(v, 3); },
        onInput: function (v) { s.rdv = v; s.presetKey = "custom"; self.presetSel.set("custom"); self.draw(); }
      });
      grid.appendChild(this.rdS.node);

      host.appendChild(grid);
      this.syncFieldVisibility();
    },

    // On the light-response tab Ci is a setting and PAR is the axis; on the A-Ci tab they
    // swap. Hiding the one that is the axis prevents the "why does this slider do nothing"
    // question before it is asked.
    syncFieldVisibility: function () {
      var light = this.state.view === "light";
      this.parS.node.style.display = light ? "none" : "";
      this.ciS.node.style.display = light ? "" : "none";
    },

    render: function () {
      this.syncFieldVisibility();
      var s = this.state, p = this.params();
      var rates = M.scaleRates(p, s.tempC);
      var i, x, d;

      var isLight = s.view === "light";
      var xDomain = isLight ? [0, 2000] : [0, 1000];
      var pts = [], envAc = [], envAj = [], envAp = [], rows = [];

      for (i = 0; i <= N; i++) {
        x = xDomain[0] + i / N * (xDomain[1] - xDomain[0]);
        d = isLight ? M.demandC3(s.ci, rates, x, true) : M.demandC3(x, rates, s.par, true);
        pts.push([x, d.An]);
        envAc.push([x, d.Ac - rates.rd]);
        envAj.push([x, d.Aj - rates.rd]);
        envAp.push([x, d.Ap - rates.rd]);
      }

      var ymax = Math.max(6, Math.ceil(Math.max.apply(null, pts.map(function (q) { return q[1]; })) / 5) * 5 + 5);
      var ymin = Math.min(-2, Math.floor(Math.min.apply(null, pts.map(function (q) { return q[1]; }))));

      var c = chart({
        width: 660, height: 320, xDomain: xDomain, yDomain: [ymin, ymax],
        xLabel: isLight ? "Sunlight, PAR (µmol photons per m² of leaf per second)"
                        : "CO₂ inside the leaf, Ci (ppm)",
        yLabel: "Photosynthesis (µmol CO₂ per m² per second)",
        ariaLabel: this.ariaSummary(pts, rates)
      });

      // Limitation bands: contiguous runs of the same binding process.
      var runStart = 0, runLim = null;
      for (i = 0; i <= N; i++) {
        x = xDomain[0] + i / N * (xDomain[1] - xDomain[0]);
        d = isLight ? M.demandC3(s.ci, rates, x, true) : M.demandC3(x, rates, s.par, true);
        var key = d.limitation.key;
        if (runLim === null) { runLim = key; runStart = x; }
        else if (key !== runLim) {
          c.band({ x0: runStart, x1: x, cls: runLim, label: this.bandLabel(runLim) });
          runLim = key; runStart = x;
        }
      }
      c.band({ x0: runStart, x1: xDomain[1], cls: runLim, label: this.bandLabel(runLim) });

      // The three potential rates, thin, so co-limitation is visibly a rounded corner
      // between two straight-ish lines rather than an unexplained curve.
      c.series({ points: envAc, cls: "ph-env ph-env-rubisco" });
      c.series({ points: envAj, cls: "ph-env ph-env-rubp" });
      if (envAp[0][1] < ymax) c.series({ points: envAp, cls: "ph-env ph-env-product" });

      if (isLight && this.ref) c.series({ points: this.ref, cls: "ph-ref" });
      c.series({ points: pts, cls: "ph-an" });

      var cursor = isLight ? null : s.par;
      if (!isLight) { /* the A-Ci tab marks nothing; PAR is a setting, not a position */ }

      var here = isLight ? M.demandC3(s.ci, rates, 1500, true) : M.demandC3(s.ci, rates, s.par, true);
      if (isLight) c.dot({ x: 1500, y: here.An, cls: "ph-dot-an" });
      else c.dot({ x: s.ci, y: here.An, cls: "ph-dot-an" });

      this.chartHost.innerHTML = "";
      this.chartHost.appendChild(c.render());
      this.chartHost.appendChild(this.legend());
      this.renderReadout(rates, pts, isLight);
    },

    bandLabel: function (key) {
      for (var k in M.LIM) if (M.LIM[k].key === key) return M.LIM[k].label;
      return "";
    },

    legend: function () {
      var d = h("ul", "ph-legend");
      d.innerHTML =
        '<li><span class="ph-key ph-key-an"></span>What the leaf actually does</li>' +
        '<li><span class="ph-key ph-key-rubisco"></span>Limit set by enzyme (Rubisco)</li>' +
        '<li><span class="ph-key ph-key-rubp"></span>Limit set by light (RuBP)</li>' +
        '<li><span class="ph-key ph-key-product"></span>Limit set by sugar export (TPU)</li>' +
        '<li><span class="ph-key ph-key-ref"></span>Where you started</li>';
      return d;
    },

    ariaSummary: function (pts, rates) {
      var last = pts[pts.length - 1];
      return "Photosynthesis rises with the x axis and levels off near " +
             fmt(last[1], 1) + " micromoles per square metre per second.";
    },

    renderReadout: function (rates, pts, isLight) {
      var s = this.state;
      var at = isLight ? M.demandC3(s.ci, rates, 1500, true) : M.demandC3(s.ci, rates, s.par, true);

      // Scan the light-response curve for the two numbers a lab exercise asks for.
      var lcp = null, sat90 = null, i;
      var lightPts = [];
      for (i = 0; i <= N; i++) {
        var par = i / N * 2000;
        lightPts.push([par, M.demandC3(s.ci, rates, par, true).An]);
      }
      var amax = lightPts[lightPts.length - 1][1];
      for (i = 1; i < lightPts.length; i++) {
        if (lcp === null && lightPts[i - 1][1] < 0 && lightPts[i][1] >= 0) {
          var t = -lightPts[i - 1][1] / (lightPts[i][1] - lightPts[i - 1][1]);
          lcp = lightPts[i - 1][0] + t * (lightPts[i][0] - lightPts[i - 1][0]);
        }
        if (sat90 === null && amax > 0 && lightPts[i][1] >= 0.9 * amax) sat90 = lightPts[i][0];
      }

      var host = this.readHost;
      host.innerHTML = "";
      var stats = h("div", "ph-readout-grid");
      function cell(label, value, sub) {
        var c = h("div", "ph-stat");
        c.appendChild(h("span", "ph-stat-value", value));
        c.appendChild(h("span", "ph-stat-label", label));
        if (sub) c.appendChild(h("span", "ph-stat-sub", sub));
        stats.appendChild(c);
      }
      cell("Net photosynthesis", fmt(at.An, 2), "µmol CO₂/m²/s" +
           (isLight ? " at full sun (1500)" : " at PAR " + Math.round(s.par)));
      cell("Gross photosynthesis", fmt(at.Ag, 2), "before respiration is subtracted");
      cell("Respiration (Rd)", fmt(rates.rd, 2), "the leaf's own cost, day and night");
      cell("What's limiting", at.limitation.label, at.limitation.sub);
      cell("Light compensation point", lcp == null ? "—" : Math.round(lcp),
           "PAR where the leaf breaks even");
      cell("90 % of maximum at", sat90 == null ? "—" : Math.round(sat90),
           "PAR — more light adds little beyond here");
      host.appendChild(stats);

      var rows = [];
      for (i = 0; i <= N; i += 12) {
        rows.push([Math.round(pts[i][0]), fmt(pts[i][1], 2)]);
      }
      host.appendChild(dataTable(
        isLight ? "Net photosynthesis against light, at the settings above"
                : "Net photosynthesis against internal CO₂, at the settings above",
        [isLight ? "PAR (µmol/m²/s)" : "Ci (ppm)", "A (µmol CO₂/m²/s)"], rows));
    }
  };

  // ========================================================================
  //  SECTION 2 -- The price of carbon is water   (+ stomata: you set Ca)
  // ========================================================================

  var water = {
    state: { axis: "temp", humidity: "rh", rh: 50, vpdFixed: 1.5, ca: 400, g1: 4.0,
             vcmax25: 90, pathway: "C3", tempC: 25, par: 1500 },

    boot: function () {
      var host = document.getElementById("ph-water-controls");
      if (!host) return;
      this.chartHost = document.getElementById("ph-water-chart");
      this.readHost = document.getElementById("ph-water-readout");
      this.draw = scheduler(this.render.bind(this));
      this.buildControls(host);
      this.render();
    },

    params: function () {
      var s = this.state;
      var base = s.pathway === "C4" ? "c4" : "sun";
      return M.params({ preset: base, vcmax25: s.pathway === "C4" ? 40 : s.vcmax25,
                        g1: s.g1, jmax25: null, tpu25: null, rd25: null });
    },

    vpdAt: function (tempC) {
      var s = this.state;
      return s.humidity === "rh" ? M.vpdFrom(tempC, s.rh) : s.vpdFixed * 1000;
    },

    buildControls: function (host) {
      var self = this, s = this.state;
      host.innerHTML = "";

      var grid = h("div", "ph-controls-grid");

      grid.appendChild(switcher({
        label: "What stays fixed as the leaf warms?", value: s.humidity, emphasis: true,
        options: [{ value: "rh", label: "Humidity stays the same (realistic)" },
                  { value: "vpd", label: "Dryness of the air stays the same (thought experiment)" }],
        hint: "Warm air holds more water, so at constant humidity it gets thirstier. Pinning the dryness instead removes that effect — which is how you find out how much of the story it is.",
        onChange: function (v) { s.humidity = v; self.syncFields(); self.render(); }
      }).node);

      grid.appendChild(switcher({
        label: "Plot against", value: s.axis,
        options: [{ value: "temp", label: "Temperature" }, { value: "par", label: "Light" }],
        onChange: function (v) { s.axis = v; self.syncFields(); self.render(); }
      }).node);

      this.rhS = slider({
        label: "Relative humidity", value: s.rh, min: 10, max: 90, step: 1, unit: "%",
        aria: "Relative humidity in percent",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.rh = v; self.draw(); }
      });
      grid.appendChild(this.rhS.node);

      this.vpdS = slider({
        label: "Dryness of the air (VPD)", value: s.vpdFixed, min: 0.2, max: 5, step: 0.1, unit: "kPa",
        aria: "Vapour pressure deficit in kilopascals",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.vpdFixed = v; self.draw(); }
      });
      grid.appendChild(this.vpdS.node);

      this.tempS = slider({
        label: "Air temperature", value: s.tempC, min: 0, max: 45, step: 0.5, unit: "°C",
        aria: "Air temperature in degrees Celsius",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tempC = v; self.draw(); }
      });
      grid.appendChild(this.tempS.node);

      this.parS = slider({
        label: "Sunlight (PAR)", value: s.par, min: 0, max: 2000, step: 10, unit: "µmol/m²/s",
        aria: "Photosynthetically active radiation",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.par = v; self.draw(); }
      });
      grid.appendChild(this.parS.node);

      grid.appendChild(slider({
        label: "CO₂ in the air (Ca)", value: s.ca, min: 150, max: 1000, step: 10, unit: "ppm",
        aria: "Ambient CO2 concentration",
        hint: "Ice age ≈ 180 · today ≈ 425 · a high-emissions 2100 ≈ 900",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.ca = v; self.draw(); }
      }).node);

      this.g1S = slider({
        label: "How freely the stomata open (g₁)", value: s.g1, min: 1, max: 8, step: 0.1,
        aria: "Medlyn stomatal slope parameter g1",
        hint: "Low = a cautious, drought-adapted leaf. High = a thirsty one.",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.g1 = v; self.draw(); }
      });
      grid.appendChild(this.g1S.node);

      this.vcS = slider({
        label: "Rubisco capacity (Vcmax25)", value: s.vcmax25, min: 10, max: 150, step: 1,
        unit: "µmol/m²/s", aria: "Maximum carboxylation rate at 25 degrees Celsius",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.vcmax25 = v; self.draw(); }
      });
      grid.appendChild(this.vcS.node);

      grid.appendChild(switcher({
        label: "Pathway", value: s.pathway,
        options: [{ value: "C3", label: "C3" }, { value: "C4", label: "C4" }],
        onChange: function (v) {
          s.pathway = v;
          s.g1 = M.preset(v === "C4" ? "c4" : "sun").g1;
          self.g1S.set(s.g1);
          self.syncFields();
          self.render();
        }
      }).node);

      host.appendChild(grid);
      this.syncFields();
    },

    syncFields: function () {
      var s = this.state;
      this.rhS.node.style.display = s.humidity === "rh" ? "" : "none";
      this.vpdS.node.style.display = s.humidity === "rh" ? "none" : "";
      this.tempS.node.style.display = s.axis === "temp" ? "none" : "";
      this.parS.node.style.display = s.axis === "par" ? "none" : "";
      this.vcS.node.style.display = s.pathway === "C4" ? "none" : "";
    },

    sample: function (x) {
      var s = this.state, p = this.params();
      var tempC = s.axis === "temp" ? x : s.tempC;
      var par = s.axis === "par" ? x : s.par;
      return M.solveLeaf({ par: par, tempC: tempC, ca: s.ca, vpd: this.vpdAt(tempC), params: p });
    },

    render: function () {
      var s = this.state, i, x;
      var xDomain = s.axis === "temp" ? [0, 45] : [0, 2000];
      var A = [], E = [], WUE = [], all = [];

      for (i = 0; i <= N; i++) {
        x = xDomain[0] + i / N * (xDomain[1] - xDomain[0]);
        var f = this.sample(x);
        var eMmol = f.E * 1000;
        A.push([x, f.An]);
        E.push([x, eMmol]);
        // Below the light compensation point A < 0 while E > 0, so A/E is negative and
        // blows up at the crossing. Clip at zero and say why, rather than draw a spike.
        WUE.push([x, f.An > 0 && eMmol > 1e-6 ? f.An / eMmol : null]);
        all.push({ x: x, f: f, e: eMmol });
      }

      var aMax = Math.max.apply(null, A.map(function (q) { return q[1]; }));
      var eMax = Math.max.apply(null, E.map(function (q) { return q[1]; }));
      var yMax = Math.max(5, Math.ceil((aMax + 2) / 5) * 5);
      var yMin = Math.min(-2, Math.floor(Math.min.apply(null, A.map(function (q) { return q[1]; }))));
      var y2Max = Math.max(2, Math.ceil((eMax + 1) / 2) * 2);
      var y2Min = yMin / yMax * y2Max;      // share the zero line across both axes

      var c = chart({
        width: 660, height: 300, margin: { top: 18, right: 62, bottom: 44, left: 60 },
        xDomain: xDomain, yDomain: [yMin, yMax], y2Domain: [y2Min, y2Max],
        xLabel: s.axis === "temp" ? "Air temperature (°C)"
                                  : "Sunlight, PAR (µmol photons per m² per second)",
        yLabel: "Photosynthesis (µmol CO₂ per m² per second)",
        y2Label: "Water lost (mmol H₂O per m² per second)",
        ariaLabel: "Carbon gain and water loss against " +
                   (s.axis === "temp" ? "temperature" : "light") + "."
      });

      // Where the leaf is losing carbon, shade it and name it.
      var negEnd = null;
      for (i = 0; i < A.length; i++) if (A[i][1] > 0) { negEnd = A[i][0]; break; }
      if (negEnd != null && negEnd > xDomain[0]) {
        c.band({ x0: xDomain[0], x1: negEnd, cls: "loss", label: "losing carbon" });
      }
      var negStart = null;
      for (i = A.length - 1; i >= 0; i--) if (A[i][1] > 0) { negStart = A[i][0]; break; }
      if (negStart != null && negStart < xDomain[1] - 1e-9) {
        c.band({ x0: negStart, x1: xDomain[1], cls: "loss", label: "losing carbon" });
      }

      c.series({ points: E, cls: "ph-e", axis: "y2" });
      c.series({ points: A, cls: "ph-an" });

      var cur = s.axis === "temp" ? s.tempC : s.par;
      c.marker({ x: cur });
      var at = this.sample(cur);
      c.dot({ x: cur, y: at.An, cls: "ph-dot-an" });
      c.dot({ x: cur, y: at.E * 1000, cls: "ph-dot-e", axis: "y2" });

      this.chartHost.innerHTML = "";
      this.chartHost.appendChild(c.render());
      this.chartHost.appendChild(this.wueStrip(WUE, xDomain, s));
      this.chartHost.appendChild(this.legend());
      this.renderReadout(all, cur, at);
    },

    // WUE gets its own short strip rather than a third axis: it is a ratio, it has a
    // different shape from either curve, and crowding it in would hide both.
    wueStrip: function (WUE, xDomain, s) {
      var vals = WUE.map(function (q) { return q[1]; }).filter(function (v) { return v != null; });
      var top = vals.length ? Math.ceil(Math.max.apply(null, vals) + 1) : 10;
      var c = chart({
        width: 660, height: 130, margin: { top: 14, right: 62, bottom: 40, left: 60 },
        xDomain: xDomain, yDomain: [0, top],
        xLabel: s.axis === "temp" ? "Air temperature (°C)" : "Sunlight, PAR (µmol per m² per second)",
        yLabel: "Carbon per water",
        ariaLabel: "Water-use efficiency, carbon gained per unit of water lost."
      });
      var gap = [];
      for (var i = 0; i < WUE.length; i++) if (WUE[i][1] == null) gap.push(WUE[i][0]);
      if (gap.length) {
        c.band({ x0: Math.min.apply(null, gap), x1: Math.max.apply(null, gap),
                 cls: "loss", label: "no carbon to divide" });
      }
      c.series({ points: WUE, cls: "ph-wue" });
      var wrap = h("div", "ph-substrip");
      wrap.appendChild(h("p", "ph-substrip-title",
        "Water-use efficiency — µmol CO₂ gained per mmol H₂O lost"));
      wrap.appendChild(c.render());
      return wrap;
    },

    legend: function () {
      var d = h("ul", "ph-legend");
      d.innerHTML =
        '<li><span class="ph-key ph-key-an"></span>Carbon gained (left axis)</li>' +
        '<li><span class="ph-key ph-key-e"></span>Water lost (right axis)</li>' +
        '<li><span class="ph-key ph-key-wue"></span>Carbon per water (strip below)</li>';
      return d;
    },

    renderReadout: function (all, cur, at) {
      var s = this.state, host = this.readHost;
      var tempC = s.axis === "temp" ? cur : s.tempC;
      var vpd = this.vpdAt(tempC);
      var eMmol = at.E * 1000;

      host.innerHTML = "";
      var stats = h("div", "ph-readout-grid");
      function cell(label, value, sub) {
        var c = h("div", "ph-stat");
        c.appendChild(h("span", "ph-stat-value", value));
        c.appendChild(h("span", "ph-stat-label", label));
        if (sub) c.appendChild(h("span", "ph-stat-sub", sub));
        stats.appendChild(c);
      }
      cell("Carbon gained", fmt(at.An, 2), "µmol CO₂/m²/s");
      cell("Water lost", fmt(eMmol, 2), "mmol H₂O/m²/s");
      cell("Carbon per water", at.An > 0 ? fmt(at.An / eMmol, 2) : "—", "µmol CO₂ per mmol H₂O");
      cell("Dryness of the air", fmt(vpd / 1000, 2), "kPa VPD at " + fmt(tempC, 1) + " °C");
      cell("Stomata open to", fmt(at.gs, 3), "mol H₂O/m²/s");
      cell("CO₂ inside ÷ outside", fmt(at.ciOverCa, 2),
           "Ci/Ca — the number Section 1 let you set by hand");

      // The two temperatures a student is meant to notice are different.
      if (s.axis === "temp") {
        var peakA = null, halfWue = null, first = null;
        for (var i = 0; i < all.length; i++) {
          if (peakA === null || all[i].f.An > peakA.f.An) peakA = all[i];
          var w = all[i].f.An > 0 && all[i].e > 1e-6 ? all[i].f.An / all[i].e : null;
          if (w != null) {
            if (first === null) first = w;
            if (halfWue === null && w < first / 2) halfWue = all[i].x;
          }
        }
        cell("Carbon peaks at", fmt(peakA.x, 1) + " °C", "past here, warmer is worse");
        cell("Efficiency halves by", halfWue == null ? "—" : fmt(halfWue, 1) + " °C",
             halfWue != null && halfWue < peakA.x
               ? "already halved before carbon even peaks"
               : "a different temperature from the carbon peak");
      }
      host.appendChild(stats);

      var rows = [], step = Math.ceil(all.length / 11);
      for (var j = 0; j < all.length; j += step) {
        var a = all[j];
        rows.push([fmt(a.x, s.axis === "temp" ? 1 : 0), fmt(a.f.An, 2), fmt(a.e, 2),
                   a.f.An > 0 ? fmt(a.f.An / a.e, 2) : "—"]);
      }
      host.appendChild(dataTable("Carbon, water and their ratio at the settings above",
        [s.axis === "temp" ? "T (°C)" : "PAR", "A (µmol/m²/s)", "E (mmol/m²/s)", "A/E"], rows));
    }
  };

  // ========================================================================
  //  SECTION 3 -- Three ways to pay that price   (+ a whole simulated day)
  // ========================================================================

  var pathways = {
    state: { view: "day", climateKey: "ithaca", ca: 400,
             tMean: null, tAmp: null, tDew: null, parMax: null, doy: null,
             show: { C3: true, C4: true, CAM: true }, tempC: 30 },

    boot: function () {
      var host = document.getElementById("ph-pathways-controls");
      if (!host) return;
      this.chartHost = document.getElementById("ph-pathways-chart");
      this.budgetHost = document.getElementById("ph-pathways-budget");
      this.draw = scheduler(this.render.bind(this));
      this.applyClimate("ithaca");
      this.buildControls(host);
      this.render();
    },

    applyClimate: function (key) {
      var c = M.climate(key), s = this.state;
      s.climateKey = key;
      s.tMean = c.tMean; s.tAmp = c.tAmp; s.tDew = c.tDew;
      s.parMax = c.parMax; s.doy = c.doy; s.lat = c.lat;
    },

    climate: function () {
      var s = this.state;
      return { lat: s.lat, doy: s.doy, parMax: s.parMax,
               tMean: s.tMean, tAmp: s.tAmp, tDew: s.tDew };
    },

    buildControls: function (host) {
      var self = this, s = this.state;
      host.innerHTML = "";

      tabs(host, [{ key: "day", label: "A day in the life" },
                  { key: "light", label: "Response to light" }],
           function (k) { s.view = k; self.syncFields(); self.render(); });

      var grid = h("div", "ph-controls-grid");

      this.climBtns = h("div", "ph-field ph-climate");
      this.climBtns.appendChild(h("span", "ph-field-name", "Where is this leaf?"));
      var row = h("div", "ph-climate-row");
      M.CLIMATES.forEach(function (cl) {
        var b = h("button", "ph-climate-btn" + (cl.key === s.climateKey ? " is-active" : ""), cl.name);
        b.type = "button";
        b.addEventListener("click", function () {
          self.applyClimate(cl.key);
          self.tMeanS.set(s.tMean); self.tAmpS.set(s.tAmp);
          self.tDewS.set(s.tDew); self.parS.set(s.parMax);
          Array.prototype.forEach.call(row.children, function (o) {
            o.classList.toggle("is-active", o === b);
          });
          self.render();
        });
        row.appendChild(b);
      });
      this.climBtns.appendChild(row);
      grid.appendChild(this.climBtns);

      grid.appendChild(toggles({
        label: "Show which pathways",
        options: [{ value: "C3", label: "C3", checked: true },
                  { value: "C4", label: "C4", checked: true },
                  { value: "CAM", label: "CAM", checked: true }],
        onChange: function (k, on) { s.show[k] = on; self.render(); }
      }).node);

      this.tMeanS = slider({
        label: "Average temperature", value: s.tMean, min: 5, max: 40, step: 0.5, unit: "°C",
        aria: "Mean daily air temperature",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tMean = v; s.climateKey = "custom"; self.clearClimate(); self.draw(); }
      });
      grid.appendChild(this.tMeanS.node);

      this.tAmpS = slider({
        label: "Day–night temperature swing", value: s.tAmp, min: 1, max: 16, step: 0.5, unit: "± °C",
        aria: "Half the daily temperature range",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tAmp = v; s.climateKey = "custom"; self.clearClimate(); self.draw(); }
      });
      grid.appendChild(this.tAmpS.node);

      this.tDewS = slider({
        label: "Dewpoint (how humid the air is)", value: s.tDew, min: -5, max: 26, step: 0.5, unit: "°C",
        aria: "Dewpoint temperature",
        hint: "Held constant through the day, so the air gets drier as it warms — which is what really happens.",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tDew = v; s.climateKey = "custom"; self.clearClimate(); self.draw(); }
      });
      grid.appendChild(this.tDewS.node);

      this.parS = slider({
        label: "Peak sunlight", value: s.parMax, min: 400, max: 2400, step: 50, unit: "µmol/m²/s",
        aria: "Peak photosynthetically active radiation at solar noon",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.parMax = v; s.climateKey = "custom"; self.clearClimate(); self.draw(); }
      });
      grid.appendChild(this.parS.node);

      this.tempS = slider({
        label: "Leaf temperature", value: s.tempC, min: 5, max: 45, step: 0.5, unit: "°C",
        aria: "Leaf temperature for the light-response comparison",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tempC = v; self.draw(); }
      });
      grid.appendChild(this.tempS.node);

      grid.appendChild(slider({
        label: "CO₂ in the air (Ca)", value: s.ca, min: 150, max: 1000, step: 10, unit: "ppm",
        aria: "Ambient CO2 concentration",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.ca = v; self.draw(); }
      }).node);

      host.appendChild(grid);
      this.syncFields();
    },

    clearClimate: function () {
      Array.prototype.forEach.call(this.climBtns.querySelectorAll(".ph-climate-btn"),
        function (b) { b.classList.remove("is-active"); });
    },

    syncFields: function () {
      var day = this.state.view === "day";
      this.tMeanS.node.style.display = day ? "" : "none";
      this.tAmpS.node.style.display = day ? "" : "none";
      this.parS.node.style.display = day ? "" : "none";
      this.tempS.node.style.display = day ? "none" : "";
      // climate buttons and dewpoint set the AIR, which both views need
    },

    render: function () {
      if (this.state.view === "day") this.renderDay();
      else this.renderLight();
    },

    // -------- the day view --------

    renderDay: function () {
      var s = this.state, cl = this.climate(), self = this;
      var runs = {};
      ["C3", "C4", "CAM"].forEach(function (k) {
        var presetKey = k === "C3" ? "sun" : k === "C4" ? "c4" : "cam";
        runs[k] = M.runDay({ params: M.params({ preset: presetKey }), climate: cl,
                             ca: s.ca, nStep: DAY_STEPS });
      });

      var shown = ["C3", "C4", "CAM"].filter(function (k) { return s.show[k]; });
      var aMax = 5, eMax = 2, aMin = -3;
      shown.forEach(function (k) {
        runs[k].series.forEach(function (p) {
          aMax = Math.max(aMax, p.An); aMin = Math.min(aMin, p.An);
          eMax = Math.max(eMax, p.E);
        });
      });
      var yMax = Math.ceil((aMax + 3) / 5) * 5, yMin = Math.floor(aMin - 1);
      var y2Max = Math.ceil((eMax + 1) / 2) * 2, y2Min = yMin / yMax * y2Max;

      var c = chart({
        width: 660, height: 330, margin: { top: 18, right: 62, bottom: 44, left: 60 },
        xDomain: [0, 24], yDomain: [yMin, yMax], y2Domain: [y2Min, y2Max],
        xTicks: [0, 3, 6, 9, 12, 15, 18, 21, 24],
        xTickFmt: function (t) { return (t < 10 ? "0" : "") + t + ":00"; },
        xLabel: "Time of day",
        yLabel: "Carbon exchange with the air (µmol CO₂ per m² per second)",
        y2Label: "Water lost (mmol H₂O per m² per second)",
        ariaLabel: "Carbon and water exchange through one simulated day for three photosynthetic pathways."
      });

      // Night shading, straight off the driver rather than assumed.
      var dl = runs.C3.daylength, rise = 12 - dl / 2, set = 12 + dl / 2;
      c.band({ x0: 0, x1: rise, cls: "night", label: "night" });
      c.band({ x0: set, x1: 24, cls: "night", label: "night" });

      shown.forEach(function (k) {
        var cls = "ph-path-" + k.toLowerCase();
        c.series({ points: runs[k].series.map(function (p) { return [p.hour, p.E]; }),
                   cls: cls + " ph-e-line", axis: "y2" });
      });
      shown.forEach(function (k) {
        var cls = "ph-path-" + k.toLowerCase();
        c.series({ points: runs[k].series.map(function (p) { return [p.hour, p.An]; }), cls: cls });
      });

      this.chartHost.innerHTML = "";
      this.chartHost.appendChild(c.render());
      this.chartHost.appendChild(this.dayLegend(shown, true));
      if (s.show.CAM) this.chartHost.appendChild(this.camPhases(rise, set));
      this.renderBudget(runs, shown, rise, set);
    },

    dayLegend: function (shown, withWater) {
      var d = h("ul", "ph-legend");
      var html = "";
      shown.forEach(function (k) {
        html += '<li><span class="ph-key ph-key-' + k.toLowerCase() + '"></span>' + k +
                (k === "CAM" ? " (dashed)" : "") + "</li>";
      });
      html += '<li><span class="ph-key ph-key-carbon"></span>carbon — thick line, left axis</li>';
      if (withWater) {
        html += '<li><span class="ph-key ph-key-waterline"></span>water — thin dotted line, right axis</li>';
      }
      d.innerHTML = html;
      return d;
    },

    camPhases: function (rise, set) {
      var p = h("p", "ph-phase-note");
      p.innerHTML =
        "<strong>Follow the dashed CAM line.</strong> Through the night it is the only one " +
        "<em>taking carbon in</em> — stomata open in cool, damp air. Through the day it sits just " +
        "below zero: the stomata are shut, so nothing is going in or out, and the sugar being made " +
        "right now is built from CO₂ captured last night.";
      return p;
    },

    // The budget table is the section's thesis: three pathways, three bargains.
    renderBudget: function (runs, shown, rise, set) {
      var host = this.budgetHost;
      if (!host) return;
      host.innerHTML = "";

      var c3w = runs.C3.water;
      var rows = shown.map(function (k) {
        var r = runs[k];
        var mm = r.water * 0.018;                    // mol H2O -> kg/m2 -> mm of water
        return [k,
                Math.round(r.carbon),
                fmt(mm, 2),
                fmt(r.wue, 2),
                fmt(r.carbon / Math.max(mm, 1e-9), 0),
                fmt(r.wue / runs.C3.wue, 2) + "×"];
      });

      var t = h("table", "ph-table ph-budget");
      var html = "<caption>What each leaf gained and spent over this whole day</caption><thead><tr>" +
        "<th scope=\"col\">Pathway</th>" +
        "<th scope=\"col\">Carbon gained<br><span>mmol CO₂ per m² per day</span></th>" +
        "<th scope=\"col\">Water spent<br><span>mm per day</span></th>" +
        "<th scope=\"col\">Carbon per water<br><span>mmol CO₂ per mol H₂O</span></th>" +
        "<th scope=\"col\">Carbon per mm of water<br><span>mmol CO₂</span></th>" +
        "<th scope=\"col\">Efficiency vs C3</th></tr></thead><tbody>";
      rows.forEach(function (r) {
        html += "<tr class=\"ph-row-" + r[0].toLowerCase() + "\">";
        r.forEach(function (cell, i) {
          html += i === 0 ? "<th scope=\"row\">" + cell + "</th>" : "<td>" + cell + "</td>";
        });
        html += "</tr>";
      });
      t.innerHTML = html + "</tbody>";
      var budgetWrap = h("div", "ph-table-wrap");
      budgetWrap.appendChild(t);
      host.appendChild(budgetWrap);

      var note = h("p", "ph-budget-note");
      note.innerHTML = "Carbon is <em>net</em> — the night's respiration has already been " +
        "subtracted. Water is given in millimetres, the same unit as rainfall, so you can " +
        "compare it with what actually falls on this place. Daylength here is " +
        fmt(runs.C3.daylength, 1) + " hours.";
      host.appendChild(note);

      // Accessible/spreadsheet version of the plotted series.
      var series = runs[shown[0]].series;
      var trows = [];
      for (var i = 0; i < series.length; i += 8) {
        var row = [(function (hh) {
          var m = Math.round(hh * 60), H = Math.floor(m / 60), Mi = m % 60;
          return (H < 10 ? "0" : "") + H + ":" + (Mi < 10 ? "0" : "") + Mi;
        })(series[i].hour), Math.round(series[i].par), fmt(series[i].tempC, 1),
          fmt(series[i].vpd / 1000, 2)];
        shown.forEach(function (k) {
          row.push(fmt(runs[k].series[i].An, 2));
          row.push(fmt(runs[k].series[i].E, 2));
        });
        trows.push(row);
      }
      var headers = ["Time", "PAR", "T (°C)", "VPD (kPa)"];
      shown.forEach(function (k) { headers.push(k + " A"); headers.push(k + " E"); });
      host.appendChild(dataTable("The simulated day, every two hours", headers, trows));
    },

    // -------- the light-response view --------

    renderLight: function () {
      var s = this.state, i, x;
      var shown = ["C3", "C4"].filter(function (k) { return s.show[k]; });
      var curves = {}, aMax = 5, aMin = -3;

      // VPD comes from the chosen climate's dewpoint at the chosen leaf temperature, so
      // this tab and the day view describe the same air rather than two different ones.
      var vpd = Math.max(M.esat(s.tempC) - M.esat(s.tDew), M.CONST.VPD_FLOOR);

      shown.forEach(function (k) {
        var p = M.params({ preset: k === "C3" ? "sun" : "c4" });
        var pts = [];
        for (i = 0; i <= N; i++) {
          x = i / N * 2000;
          var f = M.solveLeaf({ par: x, tempC: s.tempC, ca: s.ca, vpd: vpd, params: p });
          pts.push([x, f.An]);
          aMax = Math.max(aMax, f.An); aMin = Math.min(aMin, f.An);
        }
        curves[k] = pts;
      });

      // CAM's ceiling is its overnight malate charge, so it is a property of the DAY,
      // not of the instantaneous light. Read it off a full run rather than inventing one.
      var camPts = null;
      if (s.show.CAM) {
        var run = M.runDay({ params: M.params({ preset: "cam" }), climate: this.climate(),
                             ca: s.ca, nStep: DAY_STEPS });
        var ceiling = run.carbon / (run.daylength * 3600) * 1000;
        camPts = [];
        for (i = 0; i <= N; i++) {
          x = i / N * 2000;
          var camP = M.params({ preset: "cam" });
          var camRates = M.scaleRates(camP, s.tempC);
          var dd = M.demandC3(camP.ciDay, camRates, x, true);
          camPts.push([x, Math.min(dd.An, ceiling)]);
        }
        aMax = Math.max(aMax, ceiling);
      }

      var yMax = Math.ceil((aMax + 3) / 5) * 5, yMin = Math.floor(aMin - 1);
      var c = chart({
        width: 660, height: 330, xDomain: [0, 2000], yDomain: [yMin, yMax],
        xLabel: "Sunlight, PAR (µmol photons per m² per second)",
        yLabel: "Net photosynthesis (µmol CO₂ per m² per second)",
        ariaLabel: "Light response curves for the three photosynthetic pathways."
      });
      shown.forEach(function (k) { c.series({ points: curves[k], cls: "ph-path-" + k.toLowerCase() }); });
      if (camPts) c.series({ points: camPts, cls: "ph-path-cam" });

      this.chartHost.innerHTML = "";
      this.chartHost.appendChild(c.render());
      this.chartHost.appendChild(this.dayLegend(shown.concat(s.show.CAM ? ["CAM"] : []), false));

      // Where do C3 and C4 cross? That crossing is the section's most counter-intuitive
      // fact, so find it and say it in words rather than leaving it to be spotted.
      var host = this.budgetHost;
      host.innerHTML = "";
      if (s.show.C3 && s.show.C4) {
        var cross = null;
        for (i = 1; i <= N; i++) {
          var d0 = curves.C3[i - 1][1] - curves.C4[i - 1][1];
          var d1 = curves.C3[i][1] - curves.C4[i][1];
          if (d0 > 0 && d1 <= 0) { cross = curves.C3[i][0]; break; }
        }
        var p = h("p", "ph-crossover");
        p.innerHTML = cross == null
          ? "At " + fmt(s.tempC, 1) + " °C these two curves do not cross in this range."
          : "<strong>The curves cross at about " + Math.round(cross) + " µmol/m²/s.</strong> " +
            "Below that — in shade, at dawn, under a canopy — the <em>C3</em> leaf is ahead. " +
            "The CO₂ pump that makes C4 so good in bright light costs extra energy to run, and " +
            "in dim light that cost is not repaid. Try moving the temperature and watch where " +
            "the crossing goes.";
        host.appendChild(p);
      }
      var rows = [];
      for (i = 0; i <= N; i += 12) {
        var r = [Math.round(i / N * 2000)];
        shown.forEach(function (k) { r.push(fmt(curves[k][i][1], 2)); });
        if (camPts) r.push(fmt(camPts[i][1], 2));
        rows.push(r);
      }
      var hd = ["PAR"].concat(shown).concat(camPts ? ["CAM"] : []);
      host.appendChild(dataTable("Net photosynthesis against light for each pathway", hd, rows));
    }
  };

  // ------------------------------------------------------------------- boot

  function boot() { limits.boot(); water.boot(); pathways.boot(); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
