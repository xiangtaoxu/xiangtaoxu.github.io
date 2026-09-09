/*
  population.js -- the interactive Population Dynamics page for BioEE 1610.

  All maths lives in population-model.js; this file only draws and wires. It fills
  four empty divs the .qmd owns:

    #pd-logistic-controls   five rate sliders, plus a fold for target and noise
    #pd-logistic-chart      the trajectory, the birth/death flux gauge, the scrubber
    #pd-logistic-dots       the individuals: born, died, came through alive
    #pd-logistic-readout    r and K -- what you set, next to what the counts give back

  The organising rule of the page is that there is NO slider for r and none for K.
  Students set birth and death rates; r and K are readouts. The page shows the curve
  and the individuals FIRST and the equation afterwards, so the readout div sits
  below the equation in the .qmd rather than beside the charts.

  The class-overlay panel (#pd-overlay-*) is still here but is not mounted on the
  page -- boot() returns early when its divs are absent. Restoring it is two divs in
  the .qmd. See _dev/population-dynamics-tool.md.

  Every colour is a CSS class in theme.scss, never an inline attribute.
  No build step, no bundler, no dependencies.
*/

(function () {
  "use strict";

  var M = window.PopModel;
  if (!M) return;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var TRAJ_STEPS = 240;

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
  function fmt(x, d) {
    if (x == null || !isFinite(x)) return "—";
    return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
  }
  // Three significant figures, because K is hypersensitive as b0 approaches d0 and
  // a student aiming at 500 needs to see the last digit move.
  function sig3(x) {
    if (x == null || !isFinite(x)) return "—";
    if (x >= 100) return String(Math.round(x));
    if (x >= 10) return fmt(x, 1);
    return fmt(x, 2);
  }
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
  // Redraw on the next frame, never more than once per frame: a dragged slider
  // fires `input` faster than the display refreshes.
  function scheduler(fn) {
    var pending = false;
    return function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; fn(); });
    };
  }

  // ------------------------------------------------------------- chart builder

  /* A minimal x/y chart: data coordinates in, <svg> out.

     Deliberately smaller than the one on the photosynthesis page -- this page has
     no second y axis and no shaded limitation bands, but it does need horizontal
     bands (the target zone) and vertical rules (the scrub cursor and K). */
  function chart(opt) {
    var W = opt.width || 700, H = opt.height || 300;
    var m = opt.margin || { top: 16, right: 16, bottom: 42, left: 62 };
    var pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    var xd = opt.xDomain, yd = opt.yDomain;
    var layers = { bands: [], grid: [], series: [], marks: [], labels: [] };

    function X(v) { return m.left + (v - xd[0]) / (xd[1] - xd[0]) * pw; }
    function Y(v) { return m.top + ph - (v - yd[0]) / (yd[1] - yd[0]) * ph; }
    function clampY(v) { return Math.max(m.top - 4, Math.min(m.top + ph + 4, Y(v))); }

    var api = {
      x: X, y: Y, plotW: pw, plotH: ph, margin: m, width: W, height: H,

      // A horizontal band across the plot: the "hit 500" target zone.
      hband: function (o) {
        var y0 = clampY(o.y1), y1 = clampY(o.y0);
        layers.bands.push(el("rect", { x: m.left, y: y0, width: pw, height: Math.max(1, y1 - y0),
                                       "class": "pd-band " + (o.cls || "") }));
        return api;
      },
      hline: function (o) {
        layers.marks.push(el("line", { x1: m.left, x2: m.left + pw, y1: clampY(o.y), y2: clampY(o.y),
                                       "class": "pd-rule " + (o.cls || "") }));
        if (o.label) {
          layers.labels.push(el("text", { x: m.left + pw - 4, y: clampY(o.y) - 5,
                                          "class": "pd-note " + (o.labelCls || ""),
                                          "text-anchor": "end" }, o.label));
        }
        return api;
      },
      vline: function (o) {
        layers.marks.push(el("line", { x1: X(o.x), x2: X(o.x), y1: m.top, y2: m.top + ph,
                                       "class": "pd-rule " + (o.cls || "") }));
        if (o.label) {
          layers.labels.push(el("text", { x: X(o.x) + 4, y: m.top + 12,
                                          "class": "pd-note " + (o.labelCls || ""),
                                          "text-anchor": "start" }, o.label));
        }
        return api;
      },
      series: function (o) {
        var d = "", started = false, i, p;
        for (i = 0; i < o.points.length; i++) {
          p = o.points[i];
          if (p[1] == null || !isFinite(p[1])) { started = false; continue; }
          d += (started ? "L" : "M") + fmt(X(p[0]), 1) + "," + fmt(clampY(p[1]), 1);
          started = true;
        }
        if (d) layers.series.push(el("path", { d: d, "class": "pd-line " + (o.cls || "") }));
        return api;
      },
      dots: function (o) {
        for (var i = 0; i < o.points.length; i++) {
          var p = o.points[i];
          if (p[1] == null || !isFinite(p[1])) continue;
          if (Y(p[1]) < m.top - 2 || Y(p[1]) > m.top + ph + 2) continue;
          layers.marks.push(el("circle", { cx: X(p[0]), cy: Y(p[1]), r: o.r || 2.6,
                                           "class": "pd-dot " + (o.cls || "") }));
        }
        return api;
      },
      dot: function (o) {
        layers.marks.push(el("circle", { cx: X(o.x), cy: clampY(o.y), r: o.r || 4,
                                         "class": "pd-dot " + (o.cls || "") }));
        return api;
      },
      note: function (o) {
        layers.labels.push(el("text", { x: X(o.x) + (o.dx || 0), y: clampY(o.y) + (o.dy || 0),
                                        "class": "pd-note " + (o.cls || ""),
                                        "text-anchor": o.anchor || "middle" }, o.text));
        return api;
      },

      render: function () {
        var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "pd-chart",
                              role: "img", "aria-label": opt.ariaLabel || "" });
        var i, t, ticks;

        layers.bands.forEach(function (b) { svg.appendChild(b); });

        ticks = opt.yTicks || niceTicks(yd[0], yd[1], 5);
        for (i = 0; i < ticks.length; i++) {
          t = ticks[i];
          svg.appendChild(el("line", { x1: m.left, x2: m.left + pw, y1: Y(t), y2: Y(t),
            "class": Math.abs(t) < 1e-12 ? "pd-axis-zero" : "pd-gridline" }));
          svg.appendChild(el("text", { x: m.left - 8, y: Y(t) + 4, "class": "pd-tick pd-tick-y" },
                             opt.yTickFmt ? opt.yTickFmt(t) : String(t)));
        }
        ticks = opt.xTicks || niceTicks(xd[0], xd[1], 6);
        for (i = 0; i < ticks.length; i++) {
          t = ticks[i];
          svg.appendChild(el("line", { x1: X(t), x2: X(t), y1: m.top + ph, y2: m.top + ph + 5,
            "class": "pd-axis" }));
          svg.appendChild(el("text", { x: X(t), y: m.top + ph + 19, "class": "pd-tick pd-tick-x" },
                             opt.xTickFmt ? opt.xTickFmt(t) : String(t)));
        }
        svg.appendChild(el("line", { x1: m.left, x2: m.left + pw, y1: m.top + ph, y2: m.top + ph,
                                     "class": "pd-axis" }));

        layers.series.forEach(function (s) { svg.appendChild(s); });
        layers.marks.forEach(function (s) { svg.appendChild(s); });
        layers.labels.forEach(function (s) { svg.appendChild(s); });

        svg.appendChild(el("text", { x: m.left + pw / 2, y: H - 4, "class": "pd-axis-title" },
                           opt.xLabel));
        svg.appendChild(el("text", { x: 0, y: 0, "class": "pd-axis-title",
          transform: "translate(14," + (m.top + ph / 2) + ") rotate(-90)" }, opt.yLabel));
        return svg;
      }
    };
    return api;
  }

  // ------------------------------------------------------------- control widgets

  function slider(o) {
    var wrap = h("label", "pd-field");
    var head = h("span", "pd-field-head");
    head.appendChild(h("span", "pd-field-name", o.label));
    var val = h("span", "pd-field-value");
    head.appendChild(val);
    wrap.appendChild(head);
    var input = document.createElement("input");
    input.type = "range";
    input.min = o.min; input.max = o.max; input.step = o.step; input.value = o.value;
    input.setAttribute("aria-label", o.aria || o.label);
    wrap.appendChild(input);
    if (o.hint) wrap.appendChild(h("span", "pd-field-hint", o.hint));
    function show() {
      val.textContent = (o.fmt ? o.fmt(+input.value) : input.value) + (o.unit ? " " + o.unit : "");
      input.setAttribute("aria-valuetext", val.textContent);
    }
    show();
    input.addEventListener("input", function () { show(); o.onInput(+input.value); });
    return { node: wrap, input: input,
             set: function (v) { input.value = v; show(); } };
  }

  function chooser(o) {
    var wrap = h("label", "pd-field");
    wrap.appendChild(h("span", "pd-field-name", o.label));
    var sel = document.createElement("select");
    sel.setAttribute("aria-label", o.label);
    o.options.forEach(function (op) {
      var e = document.createElement("option");
      e.value = op.value; e.textContent = op.label;
      sel.appendChild(e);
    });
    sel.value = o.value;
    sel.addEventListener("change", function () { o.onChange(sel.value); });
    wrap.appendChild(sel);
    if (o.hint) wrap.appendChild(h("span", "pd-field-hint", o.hint));
    return { node: wrap, select: sel, set: function (v) { sel.value = v; } };
  }

  // Holds the two knobs that are about the OBSERVER rather than the population --
  // where to put the target band, and how badly the counting is done. Collapsed so
  // that the five rate sliders are the whole of the visible interface.
  function advanced(label) {
    var d = h("details", "pd-advanced");
    d.appendChild(h("summary", null, label));
    var grid = h("div", "pd-controls-grid");
    d.appendChild(grid);
    return { node: d, grid: grid };
  }

  // ---------------------------------------------------------- the dot field

  /* A fixed, stratified-random set of positions for the individual dots.

     Stratified (one jittered point per cell of a 30x30 grid) rather than uniform,
     because uniform random points clump and leave holes, which reads as structure
     that is not there. Then shuffled ONCE, so that taking the first n positions is
     still spatially even at any n -- the field fills smoothly as the population
     grows, and no dot ever moves.

     Because the list is already in random order, colouring by slot (survivors,
     then births, then deaths) scatters the colours across the square for free. */
  var DOT_MAX = 900;
  var dotPosCache = { key: null, pts: null };

  /* Positions for the individual dots, re-drawn once per census year.

     Stratified (one jittered point per cell of a 30x30 grid) rather than uniform,
     because uniform random points clump and leave holes, which reads as structure
     that is not there. Then shuffled, so taking the first n positions is still
     spatially even at any n. Because the list is in random order, colouring by slot
     (survivors, then births, then deaths) scatters the colours for free.

     Keyed on the YEAR, not on the frame: individuals move between censuses, which
     makes each year read as a fresh snapshot rather than a diagram being edited, but
     they hold still while the scrubber is dragged inside a single year. Re-drawing
     every frame instead would shimmer and hide the thing the panel is for. */
  function dotPositions(year) {
    if (dotPosCache.key === year) return dotPosCache.pts;
    var g = 30, rand = M.rng(70914 + year * 7919), pts = [], i, j, t;
    for (i = 0; i < g; i++) {
      for (j = 0; j < g; j++) {
        pts.push([(i + 0.15 + 0.7 * rand()) / g, (j + 0.15 + 0.7 * rand()) / g]);
      }
    }
    for (i = pts.length - 1; i > 0; i--) {          // Fisher-Yates, seeded
      j = Math.floor(rand() * (i + 1));
      t = pts[i]; pts[i] = pts[j]; pts[j] = t;
    }
    dotPosCache = { key: year, pts: pts };
    return pts;
  }

  function dotRadius(n) {
    return n <= 50 ? 5 : n <= 150 ? 4 : n <= 350 ? 3.2 : n <= 700 ? 2.6 : 2.2;
  }

  // ========================================================================
  //  PANEL 1 -- the model
  // ========================================================================

  var main = {
    // K = 300 at these defaults, with the target band at 500: the page opens with
    // the population settling somewhere OTHER than the number to aim at, so there
    // is something to do.
    p: { b0: 0.50, d0: 0.20, beta: 0, delta: 0.0010, N0: 20 },
    target: 500,
    process: 0.05,      // year-to-year variation in the vital rates
    noise: 0.05,        // observation error on the counts
    procSeed: 1,
    obsSeed: 1,
    cursor: 0,          // scrub position, in years
    playing: false,

    // Fixed, not controls. One census a year for fifty years is a plausible
    // monitoring programme and it is not what the page is about; making them
    // sliders spent two knobs of a student's attention on study design.
    T: 50,
    dt: 1,

    boot: function () {
      var self = this;
      var host = document.getElementById("pd-logistic-controls");
      if (!host) return;
      this.chartHost = document.getElementById("pd-logistic-chart");
      this.dotHost = document.getElementById("pd-logistic-dots");
      this.outHost = document.getElementById("pd-logistic-readout");
      this.draw = scheduler(this.render.bind(this));

      var grid = h("div", "pd-controls-grid");

      // delta and beta are exposed per 1000 individuals: the raw numbers are
      // 0.0006-ish and a slider reading "0.60 per 1000" is something a student can
      // hold in their head.
      this.sB0 = slider({
        label: "Birth rate b₀", value: this.p.b0, min: 0.02, max: 2, step: 0.01,
        unit: "/yr", fmt: function (v) { return fmt(v, 2); },
        hint: "births per individual per year, when uncrowded",
        onInput: function (v) { self.p.b0 = v; self.draw(); }
      });
      this.sD0 = slider({
        label: "Death rate d₀", value: this.p.d0, min: 0, max: 1.5, step: 0.01,
        unit: "/yr", fmt: function (v) { return fmt(v, 2); },
        hint: "deaths per individual per year, when uncrowded",
        onInput: function (v) { self.p.d0 = v; self.draw(); }
      });
      this.sDelta = slider({
        label: "Crowding → deaths δ", value: this.p.delta * 1000, min: 0, max: 3, step: 0.01,
        unit: "per 1000", fmt: function (v) { return fmt(v, 2); },
        hint: "each extra 1000 individuals raises the death rate by this much",
        onInput: function (v) { self.p.delta = v / 1000; self.draw(); }
      });
      // Starts at zero, but visible: crowding acting on births instead of deaths
      // gives an identical trajectory, and that is only discoverable if the slider
      // is in front of you.
      this.sBeta = slider({
        label: "Crowding → births β", value: this.p.beta * 1000, min: 0, max: 3, step: 0.01,
        unit: "per 1000", fmt: function (v) { return fmt(v, 2); },
        hint: "each extra 1000 individuals lowers the birth rate by this much",
        onInput: function (v) { self.p.beta = v / 1000; self.draw(); }
      });
      this.sN0 = slider({
        label: "Starting population N₀", value: this.p.N0, min: 2, max: 1000, step: 1,
        fmt: function (v) { return String(Math.round(v)); },
        hint: "how many individuals arrive at year zero",
        onInput: function (v) { self.p.N0 = v; self.draw(); }
      });
      [this.sB0, this.sD0, this.sDelta, this.sBeta, this.sN0].forEach(function (s) {
        grid.appendChild(s.node);
      });

      var adv = advanced("Additional parameters");
      this.cTarget = chooser({
        label: "Target equilibrium", value: "500",
        options: [{ value: "0", label: "no target" }, { value: "250", label: "250" },
                  { value: "500", label: "500" }, { value: "1000", label: "1000" }],
        hint: "marks a band on the chart to aim K at",
        onChange: function (v) { self.target = +v; self.draw(); }
      });
      this.sProcess = slider({
        label: "Year-to-year variation", value: this.process, min: 0, max: 0.2, step: 0.01,
        fmt: function (v) { return v === 0 ? "none" : Math.round(v * 100) + "%"; },
        hint: "good years and bad years: the birth and death rates themselves are " +
              "re-drawn each year. This moves the population.",
        onInput: function (v) { self.process = v; self.draw(); }
      });
      this.sNoise = slider({
        label: "Observation noise", value: this.noise, min: 0, max: 0.2, step: 0.01,
        fmt: function (v) { return v === 0 ? "none" : Math.round(v * 100) + "%"; },
        hint: "you sample, you don't census. This moves only the counts — " +
              "whatever the population did, it did.",
        onInput: function (v) { self.noise = v; self.draw(); }
      });
      adv.grid.appendChild(this.cTarget.node);
      adv.grid.appendChild(this.sProcess.node);
      adv.grid.appendChild(this.sNoise.node);

      var btns = h("div", "pd-btn-row");
      var reset = h("button", "pd-btn", "Reset");
      reset.type = "button";
      reset.addEventListener("click", function () { self.reset(); });
      // Two buttons, because there are two independent sources of chance and telling
      // them apart is most of the point: one re-runs history, the other re-runs the
      // fieldwork on the same history.
      var newHist = h("button", "pd-btn", "New history");
      newHist.type = "button";
      newHist.title = "A different run of good and bad years";
      newHist.addEventListener("click", function () {
        self.procSeed = (self.procSeed % 9999) + 1;
        self.draw();
      });
      var reseed = h("button", "pd-btn", "New census");
      reseed.type = "button";
      reseed.title = "The same population, counted by somebody else";
      reseed.addEventListener("click", function () {
        self.obsSeed = (self.obsSeed % 9999) + 1;
        self.draw();
      });
      btns.appendChild(reset);
      btns.appendChild(newHist);
      btns.appendChild(reseed);

      host.appendChild(grid);
      host.appendChild(adv.node);
      host.appendChild(btns);

      // ---- scrubber, under the trajectory
      this.scrubWrap = h("div", "pd-scrub");
      this.playBtn = h("button", "pd-btn pd-play", "▶ Play");
      this.playBtn.type = "button";
      this.playBtn.addEventListener("click", function () { self.togglePlay(); });
      this.scrubWrap.appendChild(this.playBtn);
      this.scrubInput = document.createElement("input");
      this.scrubInput.type = "range";
      this.scrubInput.className = "pd-scrub-range";
      this.scrubInput.setAttribute("aria-label", "Year shown in the flux gauge and the dot field");
      this.scrubInput.min = 0;
      this.scrubInput.max = this.T;
      this.scrubInput.step = this.T / 200;
      this.scrubInput.value = 0;
      this.scrubInput.addEventListener("input", function () {
        self.stopPlay();
        self.cursor = +self.scrubInput.value;
        self.draw();
      });
      this.scrubWrap.appendChild(this.scrubInput);
      this.scrubLabel = h("span", "pd-scrub-label");
      this.scrubWrap.appendChild(this.scrubLabel);

      this.draw();
    },

    reset: function () {
      this.p = { b0: 0.50, d0: 0.20, beta: 0, delta: 0.0010, N0: 20 };
      this.process = 0.05; this.noise = 0.05; this.target = 500;
      this.cursor = 0; this.procSeed = 1; this.obsSeed = 1;
      this.sB0.set(this.p.b0); this.sD0.set(this.p.d0);
      this.sDelta.set(this.p.delta * 1000); this.sBeta.set(0);
      this.sN0.set(this.p.N0);
      this.sProcess.set(this.process); this.sNoise.set(this.noise);
      this.cTarget.set("500");
      this.stopPlay();
      this.scrubInput.value = 0;
      this.draw();
    },

    togglePlay: function () {
      var self = this;
      if (this.playing) { this.stopPlay(); return; }
      this.playing = true;
      this.playBtn.textContent = "■ Stop";
      if (this.cursor >= this.T) this.cursor = 0;
      var last = null;
      // A play button for the first reveal, but no loop: an autoplaying loop
      // competes with the instructor, and a student who looks up mid-loop sees a
      // meaningless middle frame. Scrubbing is the real control.
      function step(ts) {
        if (!self.playing) return;
        if (last != null) {
          self.cursor = Math.min(self.T, self.cursor + (ts - last) / 1000 * (self.T / 12));
        }
        last = ts;
        self.scrubInput.value = self.cursor;
        self.draw();
        if (self.cursor >= self.T) { self.stopPlay(); return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    },

    stopPlay: function () {
      this.playing = false;
      this.playBtn.textContent = "▶ Play";
    },

    render: function () {
      var p = this.p, D = M.derived(p);
      // One realised history per render, shared by the curve, the counts, the
      // scrubber and the dot field -- they must all be describing the same run.
      var pa = M.simulate(p, this.T, { process: this.process, seed: this.procSeed });
      this.path = pa;
      var traj = [], i;
      for (i = 0; i < pa.t.length; i++) traj.push([pa.t[i], pa.N[i]]);
      var counts = M.censusFromPath(pa, { dt: this.dt, noise: this.noise, seed: this.obsSeed });
      var f = M.fit(counts, 200);

      // ---- y range. An unbounded run would otherwise put e^15 on the axis and
      // flatten everything worth looking at, so it is clipped and labelled.
      var dataMax = 0;
      for (i = 0; i < traj.length; i++) dataMax = Math.max(dataMax, traj[i][1]);
      var yMax;
      if (D.state === "unbounded") yMax = Math.max(this.target || 0, p.N0 * 4, 100) * 1.2;
      else yMax = Math.max(dataMax, this.target || 0, p.N0) * 1.22;

      var c = chart({
        xDomain: [0, this.T], yDomain: [0, yMax],
        xLabel: "years", yLabel: "population size N",
        ariaLabel: "Population size against time",
        height: 300
      });

      if (this.target > 0) {
        var lo = this.target * 0.98, hi = this.target * 1.02;
        var onTarget = D.K != null && D.K >= lo && D.K <= hi;
        c.hband({ y0: lo, y1: hi, cls: onTarget ? "pd-band-hit" : "pd-band-target" });
        c.hline({ y: this.target, cls: "pd-rule-target",
                  label: "target " + this.target, labelCls: "pd-note-target" });
      }
      if (D.K != null) {
        c.hline({ y: D.K, cls: "pd-rule-k", label: "K = " + sig3(D.K), labelCls: "pd-note-k" });
      }

      // The counts, and the curve fitted to them. Invisible under the trajectory
      // until observation noise is turned on, which is the point: with perfect
      // counting there is nothing to estimate.
      if (f) {
        var fitPts = [];
        for (i = 0; i <= TRAJ_STEPS; i++) {
          var tt = this.T * i / TRAJ_STEPS;
          fitPts.push([tt, M.logisticAt(f.r, f.K, counts[0][1], tt)]);
        }
        c.series({ points: fitPts, cls: "pd-fit" });
      }
      c.series({ points: traj, cls: "pd-traj" });
      if (this.noise > 0) c.dots({ points: counts, cls: "pd-census" });

      var Ncur = M.atTime(pa, this.cursor);
      c.vline({ x: this.cursor, cls: "pd-rule-cursor" });
      if (isFinite(Ncur) && Ncur <= yMax) c.dot({ x: this.cursor, y: Ncur, cls: "pd-cursor-dot" });

      if (D.state === "unbounded") {
        c.note({ x: this.T * 0.5, y: yMax * 0.92, text: "no equilibrium — runs off the chart",
                 cls: "pd-note-warn" });
      }

      this.chartHost.textContent = "";
      this.chartHost.appendChild(c.render());
      this.chartHost.appendChild(this.gauge(D, Ncur, yMax));
      this.chartHost.appendChild(this.scrubWrap);
      this.scrubLabel.textContent = "year " + fmt(this.cursor, 1) +
        "   N = " + (isFinite(Ncur) ? sig3(Ncur) : "—");

      this.dotHost.textContent = "";
      this.dotHost.appendChild(this.dotField());

      this.outHost.textContent = "";
      this.outHost.appendChild(this.derivedCard(D));
      this.outHost.appendChild(this.scorecard(D, f));
    },

    /* Two bars: total births against total deaths, at the scrubbed moment.

       This is the only thing on the page that shows the FLOWS rather than the
       stock. At K the trajectory is flat and students read that as nothing
       happening; here the two bars are equal and both long. The gap between them
       is dN/dt -- the lecture equation as a picture. */
    gauge: function (D, N, yMax) {
      var W = 700, H = 96, left = 62, right = 150, pw = W - left - right;
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "pd-chart pd-gauge",
                            role: "img", "aria-label": "Total births and deaths per year" });
      // Fixed scale, taken from the top of the visible population axis, so the bars
      // do not rescale while the scrubber is dragged.
      // The SCALE stays on the sliders' average rates, so the bars do not rescale
      // while the scrubber is dragged. The bars themselves use the year's realised
      // rates, so their gap is the actual slope of the curve above -- with
      // year-to-year variation on, they visibly jump from one year to the next,
      // which is the whole of what a good year and a bad year mean.
      var ref = M.rates(this.p, yMax);
      var scale = Math.max(ref.B, ref.D, 1e-9);
      var yr = this.path ? M.yearAt(this.path, this.cursor) : null;
      var cur = M.rates(this.p, isFinite(N) ? Math.min(N, yMax) : yMax, yr);

      function bar(y, v, cls, name, label) {
        var w = Math.max(0, Math.min(1, v / scale)) * pw;
        svg.appendChild(el("rect", { x: left, y: y, width: pw, height: 20, "class": "pd-bar-bg" }));
        svg.appendChild(el("rect", { x: left, y: y, width: w, height: 20, "class": "pd-bar " + cls }));
        svg.appendChild(el("text", { x: left - 8, y: y + 15, "class": "pd-bar-name",
                                     "text-anchor": "end" }, name));
        svg.appendChild(el("text", { x: left + pw + 8, y: y + 15, "class": "pd-bar-value" }, label));
        return left + w;
      }
      var xb = bar(16, cur.B, "pd-bar-birth", "births", sig3(cur.B) + " /yr");
      var xd = bar(46, cur.D, "pd-bar-death", "deaths", sig3(cur.D) + " /yr");

      // The gap between the two bar ends, drawn as the quantity it is.
      var x0 = Math.min(xb, xd), x1 = Math.max(xb, xd);
      if (x1 - x0 > 1) {
        svg.appendChild(el("rect", { x: x0, y: 16, width: x1 - x0, height: 50, "class": "pd-gap" }));
      }
      svg.appendChild(el("text", { x: left, y: 84, "class": "pd-bar-caption" },
        "dN/dt = births − deaths = " + (cur.dNdt >= 0 ? "+" : "") + sig3(cur.dNdt) +
        " individuals/yr"));
      return svg;
    },

    /* The individuals themselves, over the year ending at the scrubbed moment:
       green born, red died, black came through it alive. The three counts come from
       PopModel.cohort, which documents why they are survival-based rather than
       rate x window, and why they deliberately do not match the flux gauge above.

       Position carries no meaning -- there is no space in this model, and the square
       is a tally rather than a map. What earns the panel its place is the one thing
       the S-curve cannot show: at K the green and red counts are EQUAL and neither
       is zero, so the field stops changing size without anything stopping. */
    dotField: function () {
      var p = this.p, W = 700, H = 344, D_K = M.derived(p).K;
      var sq = 300, sx = 12, sy = 16, legend = sx + sq + 42;
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "pd-chart pd-dotfield",
                            role: "img",
                            "aria-label": "Individuals born, died and surviving in the year shown" });

      var t1 = this.cursor, t0 = Math.max(0, t1 - this.dt);
      var co = M.cohort(p, this.path, t0, t1);
      var N1 = co.N1, elapsed = co.elapsed;
      var black = co.survived, green = co.born, red = co.died;
      var pos = dotPositions(Math.max(0, Math.floor(t1)));

      // One dot per individual until that stops fitting, then per ten, per
      // hundred, and so on. The caption always says which.
      var total = black + green + red, unit = 1;
      while (total / unit > DOT_MAX) unit *= 10;
      var nb = Math.round(black / unit), ng = Math.round(green / unit),
          nr = Math.round(red / unit);
      var n = Math.min(nb + ng + nr, pos.length);
      var r = dotRadius(n);

      svg.appendChild(el("rect", { x: sx, y: sy, width: sq, height: sq, "class": "pd-square" }));
      for (var i = 0; i < n; i++) {
        var cls = i < nb ? "pd-dot-alive" : (i < nb + ng ? "pd-dot-birth" : "pd-dot-death");
        svg.appendChild(el("circle", {
          cx: fmt(sx + pos[i][0] * sq, 1), cy: fmt(sy + pos[i][1] * sq, 1),
          r: r, "class": "pd-indiv " + cls
        }));
      }

      function key(y, cls, name, value) {
        svg.appendChild(el("circle", { cx: legend + 6, cy: y - 4, r: 5,
                                       "class": "pd-key-dot " + cls }));
        svg.appendChild(el("text", { x: legend + 20, y: y, "class": "pd-key-name" }, name));
        svg.appendChild(el("text", { x: legend + 20, y: y + 16, "class": "pd-key-value" }, value));
      }
      svg.appendChild(el("text", { x: legend, y: sy + 12, "class": "pd-dot-title" },
        elapsed <= 1e-9 ? "year 0" : "year " + fmt(t0, 1) + " → " + fmt(t1, 1)));

      key(sy + 54, "pd-dot-alive", "survived from last year", sig3(black));
      key(sy + 104, "pd-dot-birth", "born, and still alive", sig3(green));
      key(sy + 154, "pd-dot-death", "died, of last year's N", sig3(red));

      svg.appendChild(el("line", { x1: legend, x2: W - 12, y1: sy + 178, y2: sy + 178,
                                   "class": "pd-axis" }));
      svg.appendChild(el("text", { x: legend, y: sy + 200, "class": "pd-key-name" },
                         "population now"));
      svg.appendChild(el("text", { x: legend, y: sy + 220, "class": "pd-dot-total" }, sig3(N1)));

      svg.appendChild(el("text", { x: sx, y: H - 8, "class": "pd-bar-caption" },
        N1 < 1 ? "the population is gone"
               : unit === 1 ? "each dot is one individual"
                            : "each dot is " + unit + " individuals"));
      // Both counts must be a real individual or more before this claims a balance:
      // an extinct population has births ~= deaths ~= 0, which is not an equilibrium.
      if (elapsed > 1e-9 && green >= 1 && red >= 1 && D_K != null &&
          Math.abs(N1 - D_K) / D_K < 0.08) {
        svg.appendChild(el("text", { x: legend, y: H - 8, "class": "pd-note-balance" },
                           "at K — births and deaths cancel, on average"));
      }
      return svg;
    },

    derivedCard: function (D) {
      var box = h("div", "pd-derived");
      function row(k, v, cls) {
        var d = h("div", "pd-derived-item" + (cls ? " " + cls : ""));
        d.appendChild(h("span", "pd-derived-label", k));
        d.appendChild(h("span", "pd-derived-value", v));
        return d;
      }
      box.appendChild(row("r = b₀ − d₀", fmt(D.r, 3) + " /yr"));

      if (D.state === "declines") {
        box.appendChild(row("K", "no positive equilibrium", "is-warn"));
        box.appendChild(h("p", "pd-state",
          "Deaths outrun births even with nobody around, so the population declines " +
          "to extinction from any starting size. Raise b₀ above d₀."));
        return box;
      }
      if (D.state === "unbounded") {
        box.appendChild(row("K", "unbounded", "is-warn"));
        box.appendChild(h("p", "pd-state",
          "With no density dependence there is nothing in the equation to stop it: " +
          "this is dN/dt = rN, the exponential, and the bracket (1 − N/K) never " +
          "bites. Give crowding some effect on deaths."));
        return box;
      }

      var hit = this.target > 0 && D.K >= this.target * 0.98 && D.K <= this.target * 1.02;
      box.appendChild(row("K = r / (β + δ)", sig3(D.K) + " individuals",
                          hit ? "is-hit" : (this.target > 0 ? "is-miss" : "")));
      box.appendChild(row("turnover at K", sig3(D.turnover) + " replaced /yr"));
      box.appendChild(row("mean lifespan at K", fmt(D.lifespan, 2) + " yr"));
      if (this.target > 0 && hit) {
        box.appendChild(h("p", "pd-state is-hit-note",
          "On target — and you never set K. It came out of the rates, and so did " +
          "the lifespan beside it."));
      }
      return box;
    },

    /* What you set, next to what somebody counting the population would report.

       No tick and no cross. Revision 3 removed them deliberately: the page is about
       population dynamics, not estimation, and a cross invites twenty minutes on why
       a fit misses. The two columns are put side by side and left to speak.

       It is also the more honest presentation now that the rates vary year to year.
       The theoretical values are what the sliders say the AVERAGE year looks like;
       the empirical ones describe the one history that actually happened. Those two
       differ for a real reason, not because the arithmetic went wrong, so scoring
       them against each other would be measuring the wrong thing. */
    scorecard: function (D, f) {
      var wrap = h("div", "pd-scorecard-wrap");
      wrap.appendChild(h("h4", "pd-scorecard-title", "r and K: theory against the counts"));
      var t = h("table", "pd-scorecard");
      var html = "<thead><tr><th scope=\"col\">quantity</th>" +
                 "<th scope=\"col\">theoretical<span class=\"pd-sc-sub\">from your rates</span></th>" +
                 "<th scope=\"col\">empirical<span class=\"pd-sc-sub\">from the counts</span></th>" +
                 "</tr></thead><tbody>";

      function ci(lo, hi, digits) {
        return "<span class=\"pd-ci\">[" + fmt(lo, digits) + ", " + fmt(hi, digits) + "]</span>";
      }

      if (!f) {
        html += "<tr><td colspan=\"3\">" +
                (D.state === "declines"
                  ? "This population went extinct. There is no growth curve left to fit."
                  : "Not enough censuses to fit a line — count more often.") +
                "</td></tr>";
      } else {
        html += "<tr><th scope=\"row\">r <span class=\"pd-sc-sub\">intrinsic growth rate</span></th>" +
                "<td>" + fmt(D.r, 3) + "</td><td>" + fmt(f.r, 3) + " " +
                (f.rCI ? ci(f.rCI[0], f.rCI[1], 3) : "") + "</td></tr>";

        html += "<tr><th scope=\"row\">K <span class=\"pd-sc-sub\">carrying capacity</span></th>" +
                "<td>" + (D.K == null ? "—" : sig3(D.K)) + "</td><td>" +
                (f.K == null ? "<em>not identifiable</em>"
                             : sig3(f.K) + " " + (f.KCI ? ci(f.KCI[0], f.KCI[1], 0) : "")) +
                "</td></tr>";

        html += "<tr><th scope=\"row\">b₀, d₀ <span class=\"pd-sc-sub\">the rates themselves</span></th>" +
                "<td>" + fmt(this.p.b0, 2) + ", " + fmt(this.p.d0, 2) + "</td>" +
                "<td><em>not recoverable — counts see only b − d</em></td></tr>";
      }
      t.innerHTML = html + "</tbody>";
      wrap.appendChild(t);

      if (f && f.K == null) {
        wrap.appendChild(h("p", "pd-scorecard-note",
          "The population has not visibly slowed down yet, so these counts carry no " +
          "information about a carrying capacity at all."));
      }
      return wrap;
    }
  };

  // ========================================================================
  //  PANEL 2 -- the class overlay
  // ========================================================================

  /* Several students' answers on one chart, on FIXED axes.

     The whole point of the overlay is that the trajectories differ in shape while
     sharing an endpoint, so an auto-scaling y axis would hide exactly what it
     exists to show. Everyone aimed at K; nobody aimed at r. */
  var overlay = {

    boot: function () {
      var self = this;
      var host = document.getElementById("pd-overlay-controls");
      if (!host) return;
      this.chartHost = document.getElementById("pd-overlay-chart");
      this.draw = scheduler(this.render.bind(this));

      var lab = h("label", "pd-field pd-field-wide");
      lab.appendChild(h("span", "pd-field-name", "One student per line: b₀, d₀"));
      this.ta = document.createElement("textarea");
      this.ta.className = "pd-textarea";
      this.ta.rows = 5;
      this.ta.value = "0.12, 0.02\n0.50, 0.20\n1.40, 0.60";
      this.ta.setAttribute("aria-label", "Student parameter pairs, b0 and d0 per line");
      this.ta.addEventListener("input", function () { self.draw(); });
      lab.appendChild(this.ta);
      lab.appendChild(h("span", "pd-field-hint",
        "Each student's crowding δ is worked out from the target above, since that " +
        "is what they were tuning it to reach — so every line here is somebody who " +
        "hit the same number a different way. Add a third value on a line to set δ " +
        "yourself instead."));
      host.appendChild(lab);

      var btns = h("div", "pd-btn-row");
      var ex = h("button", "pd-btn", "Load an example class");
      ex.type = "button";
      ex.addEventListener("click", function () {
        self.ta.value = "0.12, 0.02\n0.28, 0.10\n0.50, 0.20\n0.90, 0.42\n1.40, 0.60";
        self.draw();
      });
      var clear = h("button", "pd-btn", "Clear");
      clear.type = "button";
      clear.addEventListener("click", function () { self.ta.value = ""; self.draw(); });
      btns.appendChild(ex);
      btns.appendChild(clear);
      host.appendChild(btns);

      this.draw();
    },

    /* Each line is "b0, d0" with an optional third value for delta, per 1000.

       Two numbers is what the class reports out loud, and two numbers is all it
       takes: a student who hit the target has, by doing so, pinned their crowding
       to delta = (b0 - d0) / K. Solving for it here is a derivation, not an
       invention -- and it is what makes every line on the chart end in the same
       place, which is the only reason this panel exists. */
    parse: function () {
      var out = [];
      this.ta.value.split(/\n+/).forEach(function (line) {
        var m = line.trim().match(/^(-?[\d.]+)\s*[,;\s]\s*(-?[\d.]+)(?:\s*[,;\s]\s*(-?[\d.]+))?/);
        if (!m) return;
        var b0 = parseFloat(m[1]), d0 = parseFloat(m[2]);
        var dd = m[3] == null ? null : parseFloat(m[3]) / 1000;
        if (isFinite(b0) && isFinite(d0)) {
          out.push({ b0: b0, d0: d0, delta: dd != null && isFinite(dd) ? dd : null });
        }
      });
      return out.slice(0, 8);
    },

    render: function () {
      var rows = this.parse(), i;
      var beta = main.p.beta, N0 = main.p.N0;
      var target = main.target, T = 50;

      this.chartHost.textContent = "";
      if (!rows.length) {
        this.chartHost.appendChild(h("p", "pd-empty",
          "Type a b₀, d₀ pair per line — or load an example class."));
        return;
      }

      var series = [], yMax = Math.max(target || 0, N0);
      for (i = 0; i < rows.length; i++) {
        // Solve for the crowding this student must have used to land on the
        // target. beta rides along from the tool above, so if crowding is acting
        // partly on births there, delta only has to cover the remainder.
        var dd = rows[i].delta;
        if (dd == null) {
          dd = target > 0 ? Math.max(0, (rows[i].b0 - rows[i].d0) / target - beta)
                          : main.p.delta;
        }
        var p = { b0: rows[i].b0, d0: rows[i].d0, beta: beta, delta: dd, N0: N0 };
        var D = M.derived(p);
        series.push({ p: p, D: D, pts: M.trajectory(p, T, 200) });
        if (D.K != null) yMax = Math.max(yMax, D.K);
      }
      yMax = yMax * 1.25;

      var c = chart({
        xDomain: [0, T], yDomain: [0, yMax],
        xLabel: "years", yLabel: "population size N",
        ariaLabel: "Several students' trajectories on one chart",
        height: 300
      });
      if (target > 0) {
        c.hline({ y: target, cls: "pd-rule-target",
                  label: "target " + target, labelCls: "pd-note-target" });
      }
      for (i = 0; i < series.length; i++) {
        c.series({ points: series[i].pts, cls: "pd-traj pd-seat-" + (i % 8) });
      }
      this.chartHost.appendChild(c.render());

      // Legend doubles as the report-out table: same K down the column, every
      // other number different.
      var t = h("table", "pd-scorecard pd-legend-table");
      var html = "<thead><tr><th scope=\"col\"></th><th scope=\"col\">b₀</th>" +
                 "<th scope=\"col\">d₀</th><th scope=\"col\">δ <span class=\"pd-sc-sub\">per 1000</span></th>" +
                 "<th scope=\"col\">r</th><th scope=\"col\">K</th>" +
                 "<th scope=\"col\">mean lifespan</th><th scope=\"col\">turnover at K</th></tr></thead><tbody>";
      for (i = 0; i < series.length; i++) {
        var s = series[i], D2 = s.D;
        html += "<tr><td><span class=\"pd-swatch pd-seat-bg-" + (i % 8) + "\"></span></td>" +
                "<td>" + fmt(s.p.b0, 2) + "</td><td>" + fmt(s.p.d0, 2) + "</td>" +
                "<td>" + fmt(s.p.delta * 1000, 2) + "</td>" +
                "<td>" + fmt(D2.r, 2) + "</td>" +
                "<td>" + (D2.K == null ? "—" : sig3(D2.K)) + "</td>" +
                "<td>" + (D2.K == null ? "—" : fmt(D2.lifespan, 2) + " yr") + "</td>" +
                "<td>" + (D2.K == null ? "—" : sig3(D2.turnover) + " /yr") + "</td></tr>";
      }
      t.innerHTML = html + "</tbody>";
      this.chartHost.appendChild(t);
    }
  };

  function boot() { main.boot(); overlay.boot(); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
