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

      // The band between two curves, used to make "carbon lost to photorespiration"
      // a visible area rather than a difference the reader has to compute by eye.
      areaBetween: function (o) {
        var map = o.axis === "y2" ? Y2 : Y, i, d = "";
        var clamp = function (v) { return Math.max(m.top - 4, Math.min(m.top + ph + 4, map(v))); };
        for (i = 0; i < o.upper.length; i++) {
          d += (i ? "L" : "M") + fmt(X(o.upper[i][0]), 1) + "," + fmt(clamp(o.upper[i][1]), 1);
        }
        for (i = o.lower.length - 1; i >= 0; i--) {
          d += "L" + fmt(X(o.lower[i][0]), 1) + "," + fmt(clamp(o.lower[i][1]), 1);
        }
        layers.bands.push(el("path", { d: d + "Z", "class": "ph-area " + (o.cls || "") }));
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

      dot: function (o) {
        var map = o.axis === "y2" ? Y2 : Y;
        layers.marks.push(el("circle", { cx: X(o.x), cy: map(o.y), r: o.r || 3.5,
                                         "class": "ph-dot " + (o.cls || "") }));
        return api;
      },

      note: function (o) {
        layers.labels.push(el("text", { x: X(o.x) + (o.dx || 0),
                                        y: (o.axis === "y2" ? Y2 : Y)(o.y) + (o.dy || 0),
                                        "class": "ph-note " + (o.cls || ""),
                                        "text-anchor": o.anchor || "middle" },
                              o.text));
        return api;
      },

      // A short vertical tick rather than marker()'s full-height cursor: used to
      // pin the compensation point to the axis without drawing a line across the plot.
      stem: function (o) {
        layers.marks.push(el("line", { x1: X(o.x), x2: X(o.x), y1: Y(o.y0), y2: Y(o.y1),
                                       "class": "ph-stem" }));
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

  // Parameters that only make sense once the basics do. Collapsed by default: a
  // first-year needs Vcmax, CO2 and temperature, not two capacity ratios.
  function advanced(label) {
    var d = h("details", "ph-advanced");
    d.appendChild(h("summary", null, label));
    var grid = h("div", "ph-controls-grid");
    d.appendChild(grid);
    return { node: d, grid: grid };
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

  // Every panel mounts the same way: find the three divs the .qmd owns, wire a
  // frame-coalesced redraw, and hand back the controls host. `id` is the concept name
  // (limits / water / pathways); `out` names the third div, which differs per panel.
  function mount(panel, id, out) {
    var host = document.getElementById("ph-" + id + "-controls");
    if (!host) return null;
    panel.chartHost = document.getElementById("ph-" + id + "-chart");
    panel.outHost = document.getElementById("ph-" + id + "-" + out);
    panel.draw = scheduler(panel.render.bind(panel));
    return host;
  }

  // Redraw on the next frame, never more than once per frame. A dragged slider fires
  // `input` faster than the display refreshes; without this the work queues up.
  function zeroCrossing(pts) {
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1][1], b = pts[i][1];
      if (a == null || b == null) continue;
      if (a < 0 && b >= 0) {
        var t = -a / (b - a);
        return pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]);
      }
    }
    return null;
  }

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
    state: { presetKey: "sun", ci: 280, vcmax25: 130, jv: 1.8, rdv: 0.015, tempC: 25 },
    ref: null,

    // Oxygen removed. 2 % is the low-O2 condition photorespiration was historically
    // measured under, not a hypothetical: see PhotoModel.scaleRates.
    LOW_O2: 0.02,

    boot: function () {
      var host = mount(this, "limits", "readout");
      if (!host) return;
      this.snapshotReference();
      this.buildControls(host);
      this.render();
    },

    params: function () {
      var s = this.state;
      return M.params({ preset: s.presetKey === "custom" ? "sun" : s.presetKey,
                        pathway: "C3", vcmax25: s.vcmax25, jvRatio: s.jv, rdRatio: s.rdv,
                        jmax25: null, tpu25: null, rd25: null });
    },

    // The grey "where you started" curve, captured from the preset rather than the live
    // sliders, so every slider move reads as a change from a fixed baseline.
    snapshotReference: function () {
      var p = M.params({ preset: this.state.presetKey === "custom" ? "sun" : this.state.presetKey });
      var rates = M.scaleRates(p, 25);
      var pts = [], i;
      for (i = 0; i <= N; i++) pts.push([i / N * 2000, M.demandC3(280, rates, i / N * 2000, true).An]);
      this.ref = pts;
    },

    buildControls: function (host) {
      var self = this, s = this.state;
      host.innerHTML = "";
      var grid = h("div", "ph-controls-grid");

      // Order matters for layout: the three sliders share a row and line up, and the
      // select — which has a different height — drops to its own row rather than
      // making the first one ragged.
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
      this.ciS = slider({
        label: "CO₂ inside the leaf (Ci)", value: s.ci, min: 50, max: 1000, step: 5, unit: "ppm",
        hint: "A real leaf usually sits near 70 % of the outside air — about 280 ppm when the air is 400.",
        aria: "Intercellular CO2 concentration in parts per million",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.ci = v; self.draw(); }
      });
      grid.appendChild(this.ciS.node);

      this.tempS = slider({
        label: "Leaf temperature", value: s.tempC, min: 0, max: 45, step: 0.5, unit: "°C",
        aria: "Leaf temperature in degrees Celsius",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tempC = v; self.draw(); }
      });
      grid.appendChild(this.tempS.node);

      this.vc = slider({
        label: "Rubisco capacity (Vcmax25)", value: s.vcmax25, min: 10, max: 200, step: 1,
        unit: "µmol/m²/s", aria: "Maximum carboxylation rate at 25 degrees Celsius",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.vcmax25 = v; s.presetKey = "custom"; self.presetSel.set("custom"); self.draw(); }
      });
      grid.appendChild(this.vc.node);
      grid.appendChild(this.presetSel.node);      // second row, on its own

      host.appendChild(grid);

      // Two capacity ratios, out of the way. They reward exploration but nothing in the
      // section depends on touching them.
      var adv = advanced("Advanced parameters");
      this.jvS = slider({
        label: "Electron transport : Rubisco (Jmax/Vcmax)", value: s.jv, min: 1.0, max: 2.5, step: 0.05,
        aria: "Ratio of maximum electron transport to maximum carboxylation",
        fmt: function (v) { return fmt(v, 2); },
        onInput: function (v) { s.jv = v; s.presetKey = "custom"; self.presetSel.set("custom"); self.draw(); }
      });
      adv.grid.appendChild(this.jvS.node);

      this.rdS = slider({
        label: "Respiration : Rubisco (Rd/Vcmax)", value: s.rdv, min: 0.005, max: 0.03, step: 0.001,
        aria: "Ratio of dark respiration to maximum carboxylation",
        fmt: function (v) { return fmt(v, 3); },
        onInput: function (v) { s.rdv = v; s.presetKey = "custom"; self.presetSel.set("custom"); self.draw(); }
      });
      adv.grid.appendChild(this.rdS.node);
      host.appendChild(adv.node);
    },

    curve: function (rates, ci) {
      var pts = [], i, x;
      for (i = 0; i <= N; i++) {
        x = i / N * 2000;
        pts.push([x, M.demandC3(ci, rates, x, true).An]);
      }
      return pts;
    },

    render: function () {
      var s = this.state, p = this.params();
      var rates = M.scaleRates(p, s.tempC);
      var pts = this.curve(rates, s.ci);
      var i, x, d;

      // The oxygen-free comparison is always drawn: photorespiration is not an optional
      // detail of a C3 leaf, and the gap is the clearest thing on the chart.
      var loRates = M.scaleRates(p, s.tempC, undefined, this.LOW_O2);
      var loPts = this.curve(loRates, s.ci);

      var top = loPts;
      var ymax = Math.max(6, Math.ceil(Math.max.apply(null, top.map(function (q) { return q[1]; })) / 5) * 5 + 5);
      var ymin = Math.min(-2, Math.floor(Math.min.apply(null, pts.map(function (q) { return q[1]; }))));

      var c = chart({
        width: 660, height: 320, xDomain: [0, 2000], yDomain: [ymin, ymax],
        xLabel: "Sunlight, PAR (µmol photons per m² of leaf per second)",
        yLabel: "Photosynthesis (µmol CO₂ per m² per second)",
        ariaLabel: "Net photosynthesis against light. It rises steeply from the compensation " +
                   "point and levels off near " + fmt(pts[pts.length - 1][1], 1) +
                   " micromoles per square metre per second."
      });

      // Limitation bands: contiguous runs of the same binding process.
      var runStart = 0, runLim = null;
      for (i = 0; i <= N; i++) {
        x = i / N * 2000;
        d = M.demandC3(s.ci, rates, x, true);
        if (runLim === null) { runLim = d.limitation.key; runStart = x; }
        else if (d.limitation.key !== runLim) {
          c.band({ x0: runStart, x1: x, cls: runLim, label: this.bandLabel(runLim) });
          runLim = d.limitation.key; runStart = x;
        }
      }
      c.band({ x0: runStart, x1: 2000, cls: runLim, label: this.bandLabel(runLim) });

      // The three potential-rate ceilings are NOT drawn. With the oxygen comparison
      // permanent, three more dashed lines plus a shaded area is past what one chart can
      // carry — and the labelled background bands already answer "what is limiting?",
      // which is the section's question.
      c.areaBetween({ upper: loPts, lower: pts, cls: "ph-area-photoresp" });
      c.series({ points: loPts, cls: "ph-lowo2" });
      if (this.ref) c.series({ points: this.ref, cls: "ph-ref" });
      c.series({ points: pts, cls: "ph-an" });

      var comp = zeroCrossing(pts);
      if (comp != null) {
        c.stem({ x: comp, y0: ymin, y1: 0 });
        c.dot({ x: comp, y: 0, cls: "ph-dot-comp", r: 4.5 });
        var nearLeft = comp / 2000 < 0.18;
        c.note({ x: comp, y: 0, dy: -12, dx: nearLeft ? 9 : 0,
                 anchor: nearLeft ? "start" : "middle", cls: "ph-note-comp",
                 text: "compensation point · " + Math.round(comp) });
      }

      // Label the gap in place, so the shaded area does not need the legend to be read.
      {
        var gapAt = Math.round(N * 0.72), gx = loPts[gapAt][0];
        var lost = loPts[gapAt][1] - pts[gapAt][1];
        if (lost > 0.5) {
          c.note({ x: gx, y: (loPts[gapAt][1] + pts[gapAt][1]) / 2, dy: 4,
                   cls: "ph-note-loss",
                   text: "lost to photorespiration · " +
                         Math.round(100 * lost / loPts[gapAt][1]) + " %" });
        }
      }

      this.chartHost.innerHTML = "";
      this.chartHost.appendChild(c.render());
      this.chartHost.appendChild(this.legend());
      this.renderTable(pts, loPts);
    },

    bandLabel: function (key) {
      for (var k in M.LIM) if (M.LIM[k].key === key) return M.LIM[k].label;
      return "";
    },

    legend: function () {
      var d = h("ul", "ph-legend");
      d.innerHTML =
        '<li><span class="ph-key ph-key-an"></span>Realised rate</li>' +
        '<li><span class="ph-key ph-key-lowo2"></span>The same leaf without oxygen</li>' +
        '<li><span class="ph-key ph-key-loss"></span>Carbon lost to photorespiration</li>' +
        '<li><span class="ph-key ph-key-ref"></span>Starting values</li>' +
        '<li><span class="ph-key ph-key-comp"></span>Compensation point</li>';
      return d;
    },

    // Collapsed by default. This is the only non-visual route into the chart for a
    // screen reader, and it is what gets pasted into a spreadsheet for an assignment,
    // so it stays even though it costs no screen space.
    renderTable: function (pts, loPts) {
      var host = this.outHost, rows = [], i;
      host.innerHTML = "";
      for (i = 0; i <= N; i += 12) {
        var row = [Math.round(pts[i][0]), fmt(pts[i][1], 2)];
        if (loPts) row.push(fmt(loPts[i][1], 2));
        rows.push(row);
      }
      var hd = ["PAR (µmol/m²/s)", "A (µmol CO₂/m²/s)"];
      if (loPts) hd.push("A without oxygen");
      host.appendChild(dataTable("Net photosynthesis against light, at the settings above",
                                 hd, rows));
    }
  };

  // ========================================================================
  //  SECTION 2 -- The price of carbon is water   (+ stomata: you set Ca)
  // ========================================================================

  var water = {
    // No axis switch, no humidity switch, no pathway switch: this section asks one
    // question — what does warming do to the carbon-for-water bargain of a C3 leaf —
    // and every control that is not part of that question has been removed.
    state: { rh: 50, ca: 400, g1: 4.0, vcmax25: 130, par: 1500 },

    boot: function () {
      var host = mount(this, "water", "readout");
      if (!host) return;
      this.buildControls(host);
      this.render();
    },

    params: function () {
      var s = this.state;
      return M.params({ preset: "sun", vcmax25: s.vcmax25, g1: s.g1,
                        jmax25: null, tpu25: null, rd25: null });
    },

    // Relative humidity is held constant as the leaf warms, so vapour pressure deficit
    // follows from temperature alone. That coupling is the mechanism the section teaches.
    vpdAt: function (tempC) { return M.vpdFrom(tempC, this.state.rh); },

    buildControls: function (host) {
      var self = this, s = this.state;
      host.innerHTML = "";
      var grid = h("div", "ph-controls-grid");

      grid.appendChild(slider({
        label: "Relative humidity", value: s.rh, min: 10, max: 90, step: 1, unit: "%",
        aria: "Relative humidity in percent",
        hint: "Held constant as the leaf warms — so the air's drying power still rises, because warm air holds more vapour.",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.rh = v; self.draw(); }
      }).node);

      grid.appendChild(slider({
        label: "CO₂ in the air (Ca)", value: s.ca, min: 150, max: 1000, step: 10, unit: "ppm",
        aria: "Ambient CO2 concentration",
        hint: "Ice age ≈ 180 · today ≈ 425 · a high-emissions 2100 ≈ 900",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.ca = v; self.draw(); }
      }).node);

      grid.appendChild(slider({
        label: "How freely the stomata open (g₁)", value: s.g1, min: 1, max: 8, step: 0.1,
        aria: "Medlyn stomatal slope parameter g1",
        hint: "Low = a cautious, drought-adapted leaf. High = a thirsty one.",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.g1 = v; self.draw(); }
      }).node);

      host.appendChild(grid);

      var adv = advanced("Advanced parameters");
      adv.grid.appendChild(slider({
        label: "Sunlight (PAR)", value: s.par, min: 0, max: 2000, step: 10, unit: "µmol/m²/s",
        aria: "Photosynthetically active radiation",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.par = v; self.draw(); }
      }).node);
      adv.grid.appendChild(slider({
        label: "Rubisco capacity (Vcmax25)", value: s.vcmax25, min: 10, max: 200, step: 1,
        unit: "µmol/m²/s", aria: "Maximum carboxylation rate at 25 degrees Celsius",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.vcmax25 = v; self.draw(); }
      }).node);
      host.appendChild(adv.node);
    },

    render: function () {
      var s = this.state, p = this.params(), i, x;
      var A = [], E = [], WUE = [], CICA = [], all = [];

      for (i = 0; i <= N; i++) {
        x = i / N * 45;
        var f = M.solveLeaf({ par: s.par, tempC: x, ca: s.ca, vpd: this.vpdAt(x), params: p });
        var eMmol = f.E * 1000;
        A.push([x, f.An]);
        E.push([x, eMmol]);
        // Below the light compensation point A < 0 while E > 0, so A/E is negative and
        // unbounded at the crossing. Break the line and label the region instead.
        WUE.push([x, f.An > 0 && eMmol > 1e-6 ? f.An / eMmol : null]);
        // Ci/Ca is only meaningful while the leaf is a net CO2 sink. Past the point
        // where A goes negative the solver's night branch puts Ci ABOVE Ca (correct --
        // the leaf is a source), which would draw a spike above 1 that means something
        // entirely different from the ratio being plotted. Break the line instead.
        CICA.push([x, f.An > 0 ? f.ciOverCa : null]);
        all.push({ x: x, f: f, e: eMmol });
      }

      var aMax = Math.max.apply(null, A.map(function (q) { return q[1]; }));
      var eMax = Math.max.apply(null, E.map(function (q) { return q[1]; }));
      var yMax = Math.max(5, Math.ceil((aMax + 2) / 5) * 5);
      var yMin = Math.min(-2, Math.floor(Math.min.apply(null, A.map(function (q) { return q[1]; }))));
      var y2Max = Math.max(2, Math.ceil((eMax + 1) / 2) * 2);
      var y2Min = yMin / yMax * y2Max;          // share the zero line across both axes

      var c = chart({
        width: 660, height: 300, margin: { top: 18, right: 62, bottom: 44, left: 60 },
        xDomain: [0, 45], yDomain: [yMin, yMax], y2Domain: [y2Min, y2Max],
        xLabel: "Air temperature (°C)",
        yLabel: "Photosynthesis (µmol CO₂ per m² per second)",
        y2Label: "Water lost (mmol H₂O per m² per second)",
        ariaLabel: "Carbon gain and water loss against air temperature at constant relative humidity."
      });

      var negEnd = null, negStart = null;
      for (i = 0; i < A.length; i++) if (A[i][1] > 0) { negEnd = A[i][0]; break; }
      for (i = A.length - 1; i >= 0; i--) if (A[i][1] > 0) { negStart = A[i][0]; break; }
      if (negEnd != null && negEnd > 0) c.band({ x0: 0, x1: negEnd, cls: "loss", label: "losing carbon" });
      if (negStart != null && negStart < 45) c.band({ x0: negStart, x1: 45, cls: "loss", label: "losing carbon" });

      c.series({ points: E, cls: "ph-e", axis: "y2" });
      c.series({ points: A, cls: "ph-an" });

      // The two peaks are the point: carbon turns over before water does.
      var peakA = null, peakE = null;
      for (i = 0; i < all.length; i++) {
        if (peakA === null || all[i].f.An > peakA.f.An) peakA = all[i];
        if (peakE === null || all[i].e > peakE.e) peakE = all[i];
      }
      // The peaks sit only a few degrees apart and at a similar height, so the labels
      // are anchored in OPPOSITE directions -- carbon's text runs left from its dot,
      // water's runs right -- which keeps them clear however close the peaks get.
      if (peakA && peakA.f.An > 0) {
        c.dot({ x: peakA.x, y: peakA.f.An, cls: "ph-dot-an" });
        c.note({ x: peakA.x, y: peakA.f.An, dy: -12, dx: -9, anchor: "end",
                 cls: "ph-note-peak", text: "carbon peaks · " + fmt(peakA.x, 0) + " °C" });
      }
      if (peakE && peakE.e > 0) {
        c.dot({ x: peakE.x, y: peakE.e, cls: "ph-dot-e", axis: "y2" });
        c.note({ x: peakE.x, y: peakE.e, dy: -12, dx: 9, anchor: "start", axis: "y2",
                 cls: "ph-note-peak-e", text: "water peaks · " + fmt(peakE.x, 0) + " °C" });
      }

      this.chartHost.innerHTML = "";
      this.chartHost.appendChild(c.render());
      this.chartHost.appendChild(this.wueStrip(WUE, CICA));
      this.chartHost.appendChild(this.legend());
      this.renderTable(all);
    },

    // Water-use efficiency gets its own strip rather than a third axis: it is a ratio,
    // its shape differs from both curves, and crowding it in would hide all three.
    wueStrip: function (WUE, CICA) {
      var vals = WUE.map(function (q) { return q[1]; }).filter(function (v) { return v != null; });
      var top = vals.length ? Math.ceil(Math.max.apply(null, vals) + 1) : 10;
      var c = chart({
        width: 660, height: 165, margin: { top: 14, right: 62, bottom: 40, left: 60 },
        xDomain: [0, 45], yDomain: [0, top],
        // Ci/Ca is a fraction, so its axis is fixed rather than auto-scaled: auto-scaling
        // would turn a modest 0.89 -> 0.73 drift into what looks like a collapse, and the
        // point is that leaves hold this ratio remarkably steady. The floor is 0.5 rather
        // than 0 both to leave the curve legible and because 0.5 is a real reference --
        // it is roughly where a C4 leaf operates (section 3).
        y2Domain: [0.5, 1.0], y2Ticks: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        y2TickFmt: function (t) { return t.toFixed(1); },
        xLabel: "Air temperature (°C)",
        yLabel: "Carbon per water", y2Label: "CO₂ inside ÷ outside",
        ariaLabel: "Water-use efficiency falls steadily as the leaf warms, and the ratio " +
                   "of internal to ambient CO2 drifts down with it."
      });
      var gap = [];
      for (var i = 0; i < WUE.length; i++) if (WUE[i][1] == null) gap.push(WUE[i][0]);
      if (gap.length) {
        c.band({ x0: Math.min.apply(null, gap), x1: Math.max.apply(null, gap),
                 cls: "loss", label: "no carbon to divide" });
      }
      c.series({ points: CICA, cls: "ph-cica", axis: "y2" });
      c.series({ points: WUE, cls: "ph-wue" });
      var wrap = h("div", "ph-substrip");
      wrap.appendChild(h("p", "ph-substrip-title",
        "What the stomata are trading — carbon per water (left) and the CO₂ they hold inside (right)"));
      wrap.appendChild(c.render());
      return wrap;
    },

    legend: function () {
      var d = h("ul", "ph-legend");
      d.innerHTML =
        '<li><span class="ph-key ph-key-an"></span>Carbon gained (left axis)</li>' +
        '<li><span class="ph-key ph-key-e"></span>Water lost (right axis)</li>' +
        '<li><span class="ph-key ph-key-wue"></span>Carbon per water (strip below, left)</li>' +
        '<li><span class="ph-key ph-key-cica"></span>CO₂ inside ÷ outside (strip below, right)</li>';
      return d;
    },

    // Collapsed: the screen-reader route into the chart, and the spreadsheet route for
    // an assignment. Same reasoning as section 1.
    renderTable: function (all) {
      var host = this.outHost, rows = [], step = Math.ceil(all.length / 12), j;
      host.innerHTML = "";
      for (j = 0; j < all.length; j += step) {
        var a = all[j];
        rows.push([fmt(a.x, 1), fmt(this.vpdAt(a.x) / 1000, 2), fmt(a.f.An, 2), fmt(a.e, 2),
                   a.f.An > 0 ? fmt(a.f.An / a.e, 2) : "—",
                   a.f.An > 0 ? fmt(a.f.ciOverCa, 3) : "—"]);
      }
      host.appendChild(dataTable(
        "Carbon, water and their ratio against temperature, at the settings above",
        ["T (°C)", "VPD (kPa)", "A (µmol/m²/s)", "E (mmol/m²/s)", "A/E", "Ci/Ca"], rows));
    }
  };

  // ========================================================================
  //  SECTION 3 -- Three ways to pay that price   (+ a whole simulated day)
  // ========================================================================

  var pathways = {
    // One view, three pathways, always all three. The only choice left is whether you
    // are looking at the carbon side or the water side of the same day -- and splitting
    // those apart is what lets each chart use a single, unambiguous y axis.
    state: { view: "carbon", climateKey: "ithaca", ca: 400,
             tMean: null, tAmp: null, tDew: null, parMax: null, doy: null, lat: null },

    PATHS: [
      { key: "C3",  preset: "sun", label: "C3" },
      { key: "C4",  preset: "c4",  label: "C4" },
      { key: "CAM", preset: "cam", label: "CAM (dashed)" }
    ],

    boot: function () {
      var host = mount(this, "pathways", "budget");
      if (!host) return;
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

      tabs(host, [{ key: "carbon", label: "Carbon" }, { key: "water", label: "Water" }],
           function (k) { s.view = k; self.render(); });

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

      this.tMeanS = slider({
        label: "Average temperature", value: s.tMean, min: 5, max: 40, step: 0.5, unit: "°C",
        aria: "Mean daily air temperature",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tMean = v; self.clearClimate(); self.draw(); }
      });
      grid.appendChild(this.tMeanS.node);

      this.tDewS = slider({
        label: "Dewpoint (how humid the air is)", value: s.tDew, min: -5, max: 26, step: 0.5, unit: "°C",
        aria: "Dewpoint temperature",
        hint: "Held constant through the day, so the air dries out as it warms and grows humid again at night.",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tDew = v; self.clearClimate(); self.draw(); }
      });
      grid.appendChild(this.tDewS.node);

      grid.appendChild(slider({
        label: "CO₂ in the air (Ca)", value: s.ca, min: 150, max: 1000, step: 10, unit: "ppm",
        aria: "Ambient CO2 concentration",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.ca = v; self.draw(); }
      }).node);

      host.appendChild(grid);

      var adv = advanced("Advanced parameters");
      this.tAmpS = slider({
        label: "Day–night temperature swing", value: s.tAmp, min: 1, max: 16, step: 0.5, unit: "± °C",
        aria: "Half the daily temperature range",
        fmt: function (v) { return fmt(v, 1); },
        onInput: function (v) { s.tAmp = v; self.clearClimate(); self.draw(); }
      });
      adv.grid.appendChild(this.tAmpS.node);

      this.parS = slider({
        label: "Peak sunlight", value: s.parMax, min: 400, max: 2400, step: 50, unit: "µmol/m²/s",
        aria: "Peak photosynthetically active radiation at solar noon",
        fmt: function (v) { return String(Math.round(v)); },
        onInput: function (v) { s.parMax = v; self.clearClimate(); self.draw(); }
      });
      adv.grid.appendChild(this.parS.node);
      host.appendChild(adv.node);
    },

    clearClimate: function () {
      this.state.climateKey = "custom";
      Array.prototype.forEach.call(this.climBtns.querySelectorAll(".ph-climate-btn"),
        function (b) { b.classList.remove("is-active"); });
    },

    render: function () {
      var s = this.state, cl = this.climate(), self = this;
      var runs = {};
      this.PATHS.forEach(function (pth) {
        runs[pth.key] = M.runDay({ params: M.params({ preset: pth.preset }), climate: cl,
                                   ca: s.ca, nStep: DAY_STEPS });
      });

      var carbon = s.view === "carbon";
      var pick = function (p) { return carbon ? p.An : p.E; };

      var vMax = carbon ? 5 : 2, vMin = 0;
      this.PATHS.forEach(function (pth) {
        runs[pth.key].series.forEach(function (p) {
          vMax = Math.max(vMax, pick(p)); vMin = Math.min(vMin, pick(p));
        });
      });
      var yMax = Math.ceil((vMax + (carbon ? 3 : 1)) / (carbon ? 5 : 2)) * (carbon ? 5 : 2);
      var yMin = Math.floor(vMin - (carbon ? 1 : 0.2));

      var c = chart({
        width: 660, height: 320, margin: { top: 18, right: 20, bottom: 44, left: 62 },
        xDomain: [0, 24], yDomain: [yMin, yMax],
        xTicks: [0, 3, 6, 9, 12, 15, 18, 21, 24],
        xTickFmt: function (t) { return (t < 10 ? "0" : "") + t + ":00"; },
        xLabel: "Time of day",
        yLabel: carbon ? "Carbon exchange with the air (µmol CO₂ per m² per second)"
                       : "Water lost (mmol H₂O per m² per second)",
        ariaLabel: (carbon ? "Carbon" : "Water") +
                   " exchange through one simulated day for three photosynthetic pathways."
      });

      // Night shading comes from the driver's own daylength, not an assumption.
      var dl = runs.C3.daylength, rise = 12 - dl / 2, set = 12 + dl / 2;
      c.band({ x0: 0, x1: rise, cls: "night", label: "night" });
      c.band({ x0: set, x1: 24, cls: "night", label: "night" });

      this.PATHS.forEach(function (pth) {
        c.series({ points: runs[pth.key].series.map(function (p) { return [p.hour, pick(p)]; }),
                   cls: "ph-path-" + pth.key.toLowerCase() });
      });

      this.chartHost.innerHTML = "";
      this.chartHost.appendChild(c.render());
      this.chartHost.appendChild(this.legend());
      this.chartHost.appendChild(this.camNote(carbon));
      this.renderBudget(runs);
    },

    legend: function () {
      var d = h("ul", "ph-legend");
      d.innerHTML = this.PATHS.map(function (p) {
        return '<li><span class="ph-key ph-key-' + p.key.toLowerCase() + '"></span>' +
               p.label + "</li>";
      }).join("");
      return d;
    },

    camNote: function (carbon) {
      var p = h("p", "ph-phase-note");
      p.innerHTML = carbon
        ? "<strong>Follow the dashed CAM line.</strong> Through the night it is the only " +
          "one <em>taking carbon in</em>. Through the day it sits just below zero: the " +
          "stomata are shut, so nothing enters or leaves, and the sugar being built right " +
          "now comes from CO₂ captured last night."
        : "<strong>Follow the dashed CAM line.</strong> Its water loss is inverted too — " +
          "almost nothing by day, and what little it spends it spends at night, when the " +
          "air is coolest and closest to saturation. That is the entire strategy: buy " +
          "carbon at the hour when water is cheapest.";
      return p;
    },

    // The budget table is the section's thesis: three pathways, three bargains. It does
    // not change with the carbon/water tab, because it is about the whole day either way.
    renderBudget: function (runs) {
      var host = this.outHost, self = this;
      if (!host) return;
      host.innerHTML = "";

      var rows = this.PATHS.map(function (pth) {
        var r = runs[pth.key];
        var mm = r.water * 0.018;                   // mol H2O -> kg/m2 -> mm of water
        return [pth.key, Math.round(r.carbon), fmt(mm, 2), fmt(r.wue, 2),
                fmt(r.carbon / Math.max(mm, 1e-9), 0), fmt(r.wue / runs.C3.wue, 2) + "×"];
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
      var wrap = h("div", "ph-table-wrap");
      wrap.appendChild(t);
      host.appendChild(wrap);

      var note = h("p", "ph-budget-note");
      note.innerHTML = "Carbon is <em>net</em> — the night's respiration has already been " +
        "subtracted. Water is given in millimetres, the same unit as rainfall, so it can be " +
        "compared with what actually falls on this place. Daylength here is " +
        fmt(runs.C3.daylength, 1) + " hours.";
      host.appendChild(note);

      var series = runs.C3.series, trows = [], i;
      for (i = 0; i < series.length; i += 8) {
        var row = [(function (hh) {
          var mm = Math.round(hh * 60), H = Math.floor(mm / 60), Mi = mm % 60;
          return (H < 10 ? "0" : "") + H + ":" + (Mi < 10 ? "0" : "") + Mi;
        })(series[i].hour), Math.round(series[i].par), fmt(series[i].tempC, 1),
          fmt(series[i].vpd / 1000, 2)];
        self.PATHS.forEach(function (pth) {
          row.push(fmt(runs[pth.key].series[i].An, 2));
          row.push(fmt(runs[pth.key].series[i].E, 2));
        });
        trows.push(row);
      }
      var headers = ["Time", "PAR", "T (°C)", "VPD (kPa)"];
      this.PATHS.forEach(function (pth) { headers.push(pth.key + " A"); headers.push(pth.key + " E"); });
      host.appendChild(dataTable("The simulated day, every two hours", headers, trows));
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
