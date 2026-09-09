/*
  population.js -- the interactive Population Dynamics page for BioEE 1610.

  All maths lives in population-model.js; this file only draws and wires. Two
  panels, mounting into empty divs the .qmd owns:

    #pd-logistic-*   the model: vital-rate knobs in, r and K out, plus the fit
    #pd-overlay-*    the class overlay -- several students' answers on one chart

  The organising rule of the page is that there is NO slider for r and none for K.
  Students set birth and death rates; r and K are readouts. See
  _dev/population-dynamics-tool.md for why that is the whole design.

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

  // Density-dependent BIRTHS start switched off and collapsed. The default page is
  // then three rate knobs and a b(N)/d(N) chart of one flat line and one rising
  // line -- the cleanest version of that figure. Opening this is what makes the
  // "which vital rate is density-dependent?" ambiguity available.
  function advanced(label) {
    var d = h("details", "pd-advanced");
    d.appendChild(h("summary", null, label));
    var grid = h("div", "pd-controls-grid");
    d.appendChild(grid);
    return { node: d, grid: grid };
  }

  function tabs(host, items, onPick) {
    var bar = h("div", "pd-tabs");
    var btns = items.map(function (it, i) {
      var b = h("button", "pd-tab" + (i === 0 ? " is-active" : ""), it.label);
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

  // ========================================================================
  //  PANEL 1 -- the model, and the fit
  // ========================================================================

  var main = {
    p: { b0: 0.50, d0: 0.20, beta: 0, delta: 0.0006, N0: 20 },
    target: 500,
    T: 50,
    dt: 1,
    noise: 0,
    seed: 1,
    cursor: 0,          // scrub position, in years
    view: "rates",      // second chart: "rates" | "fit"
    playing: false,

    boot: function () {
      var self = this;
      var host = document.getElementById("pd-logistic-controls");
      if (!host) return;
      this.chartHost = document.getElementById("pd-logistic-chart");
      this.outHost = document.getElementById("pd-logistic-readout");
      this.draw = scheduler(this.render.bind(this));

      var grid = h("div", "pd-controls-grid");

      // Rate knobs. delta and beta are exposed per 1000 individuals: the raw
      // numbers are 0.0006-ish and a slider reading "0.60 per 1000" is something a
      // student can hold in their head.
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
      this.sN0 = slider({
        label: "Starting population N₀", value: this.p.N0, min: 2, max: 1000, step: 1,
        fmt: function (v) { return String(Math.round(v)); },
        hint: "how many individuals arrive at year zero",
        onInput: function (v) { self.p.N0 = v; self.draw(); }
      });
      [this.sB0, this.sD0, this.sDelta, this.sN0].forEach(function (s) {
        grid.appendChild(s.node);
      });

      var adv = advanced("Also let crowding reduce births");
      this.sBeta = slider({
        label: "Crowding → births β", value: this.p.beta * 1000, min: 0, max: 3, step: 0.01,
        unit: "per 1000", fmt: function (v) { return fmt(v, 2); },
        hint: "each extra 1000 individuals lowers the birth rate by this much. " +
              "Two populations with the same r and K but different β and δ " +
              "give the same trajectory — the curve cannot tell you which rate " +
              "the crowding acts on.",
        onInput: function (v) { self.p.beta = v / 1000; self.draw(); }
      });
      adv.grid.appendChild(this.sBeta.node);

      // Study-design knobs: how the imaginary ecologist counted.
      var grid2 = h("div", "pd-controls-grid");
      this.cTarget = chooser({
        label: "Target equilibrium", value: "500",
        options: [{ value: "0", label: "no target" }, { value: "250", label: "250" },
                  { value: "500", label: "500" }, { value: "1000", label: "1000" }],
        hint: "tune the rates until K lands in the band",
        onChange: function (v) { self.target = +v; self.draw(); }
      });
      this.cT = chooser({
        label: "Years to follow", value: "50",
        options: [{ value: "25", label: "25" }, { value: "50", label: "50" },
                  { value: "100", label: "100" }],
        onChange: function (v) {
          self.T = +v;
          self.cursor = Math.min(self.cursor, self.T);
          self.rebuildScrub();
          self.draw();
        }
      });
      this.cDt = chooser({
        label: "Census every", value: "1",
        options: [{ value: "0.5", label: "6 months" }, { value: "1", label: "1 year" },
                  { value: "2", label: "2 years" }, { value: "5", label: "5 years" }],
        hint: "how often somebody goes out and counts",
        onChange: function (v) { self.dt = +v; self.draw(); }
      });
      this.sNoise = slider({
        label: "Observation noise", value: 0, min: 0, max: 0.2, step: 0.01,
        fmt: function (v) { return v === 0 ? "none" : Math.round(v * 100) + "%"; },
        hint: "you sample, you don't census. This is measurement error only — " +
              "the population itself still follows the smooth curve exactly.",
        onInput: function (v) { self.noise = v; self.draw(); }
      });
      [this.cTarget, this.cT, this.cDt, this.sNoise].forEach(function (s) {
        grid2.appendChild(s.node);
      });

      var btns = h("div", "pd-btn-row");
      var reset = h("button", "pd-btn", "Reset");
      reset.type = "button";
      reset.addEventListener("click", function () { self.reset(); });
      var reseed = h("button", "pd-btn", "New census");
      reseed.type = "button";
      reseed.title = "Same population, somebody else's field season";
      reseed.addEventListener("click", function () {
        self.seed = (self.seed % 9999) + 1;
        self.draw();
      });
      btns.appendChild(reset);
      btns.appendChild(reseed);

      host.appendChild(grid);
      host.appendChild(adv.node);
      host.appendChild(grid2);
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
      this.scrubInput.setAttribute("aria-label", "Year shown in the flux gauge");
      this.scrubInput.addEventListener("input", function () {
        self.stopPlay();
        self.cursor = +self.scrubInput.value;
        self.draw();
      });
      this.scrubWrap.appendChild(this.scrubInput);
      this.scrubLabel = h("span", "pd-scrub-label");
      this.scrubWrap.appendChild(this.scrubLabel);
      this.rebuildScrub();

      tabs(this.outHost, [{ key: "rates", label: "Births and deaths" },
                          { key: "fit", label: "How the fit works" }],
           function (k) { self.view = k; self.draw(); });
      this.viewHost = h("div", "pd-view");
      this.outHost.appendChild(this.viewHost);
      this.cardHost = h("div", "pd-card-host");
      this.outHost.appendChild(this.cardHost);

      this.draw();
    },

    reset: function () {
      this.p = { b0: 0.50, d0: 0.20, beta: 0, delta: 0.0006, N0: 20 };
      this.noise = 0; this.dt = 1; this.T = 50; this.cursor = 0; this.seed = 1;
      this.sB0.set(this.p.b0); this.sD0.set(this.p.d0);
      this.sDelta.set(this.p.delta * 1000); this.sBeta.set(0);
      this.sN0.set(this.p.N0); this.sNoise.set(0);
      this.cDt.set("1"); this.cT.set("50");
      this.stopPlay();
      this.rebuildScrub();
      this.draw();
    },

    rebuildScrub: function () {
      this.scrubInput.min = 0;
      this.scrubInput.max = this.T;
      this.scrubInput.step = this.T / 200;
      this.scrubInput.value = this.cursor;
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
        if (last != null) self.cursor = Math.min(self.T, self.cursor + (ts - last) / 1000 * (self.T / 12));
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
      var p = this.p, D = M.derived(p), self = this;
      var traj = M.trajectory(p, this.T, TRAJ_STEPS);
      var counts = M.census(p, { dt: this.dt, T: this.T, noise: this.noise, seed: this.seed });
      var f = M.fit(counts, 200);

      // ---- y range. An unbounded run would otherwise put e^15 on the axis and
      // flatten everything worth looking at, so it is clipped and labelled.
      var dataMax = 0, i;
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

      // The fit, shown here as the logistic curve it implies. When K is not
      // identifiable, logisticAt falls back to the exponential -- which is exactly
      // what the fit is claiming in that case.
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

      var Ncur = M.sizeAt(p, this.cursor);
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

      // ---- second chart
      this.viewHost.textContent = "";
      this.viewHost.appendChild(this.view === "rates" ? this.ratesChart(D, Ncur, yMax)
                                                      : this.fitChart(f, D));
      // ---- readouts
      this.cardHost.textContent = "";
      this.cardHost.appendChild(this.derivedCard(D));
      this.cardHost.appendChild(this.scorecard(D, f));
    },

    /* Two bars: total births against total deaths, at the scrubbed moment.

       This is the only thing on the page that shows the FLOWS rather than the
       stock. At K the trajectory is flat and boring, and students read that as
       nothing happening; here the two bars are equal and both long. The gap
       between them is dN/dt -- the lecture equation as a picture. */
    gauge: function (D, N, yMax) {
      var W = 700, H = 96, left = 62, right = 150, pw = W - left - right;
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "pd-chart pd-gauge",
                            role: "img", "aria-label": "Total births and deaths per year" });
      // Fixed scale, taken from the top of the visible population axis, so the bars
      // do not rescale while the scrubber is dragged.
      var ref = M.rates(this.p, yMax);
      var scale = Math.max(ref.B, ref.D, 1e-9);
      var cur = M.rates(this.p, isFinite(N) ? Math.min(N, yMax) : yMax);

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
        svg.appendChild(el("rect", { x: x0, y: 16, width: x1 - x0, height: 50,
                                     "class": "pd-gap" }));
      }
      svg.appendChild(el("text", { x: left, y: 84, "class": "pd-bar-caption" },
        "dN/dt = births − deaths = " + (cur.dNdt >= 0 ? "+" : "") + sig3(cur.dNdt) + " individuals/yr"));
      return svg;
    },

    /* Per-capita b(N) and d(N). Where they cross IS K -- nothing caps the
       population from outside. */
    ratesChart: function (D, Ncur, yMax) {
      var p = this.p, i, N, pts = [], bp = [], dp = [];
      var xMax = yMax;
      for (i = 0; i <= 160; i++) {
        N = xMax * i / 160;
        var rr = M.rates(p, N);
        bp.push([N, rr.b]);
        dp.push([N, rr.d]);
      }
      var yTop = Math.max(p.b0, p.d0 + p.delta * xMax) * 1.1;
      var c = chart({
        xDomain: [0, xMax], yDomain: [0, yTop],
        xLabel: "population size N", yLabel: "per-capita rate (/yr)",
        ariaLabel: "Per-capita birth and death rates against population size",
        height: 260, yTickFmt: function (v) { return fmt(v, 2); }
      });
      if (this.target > 0) c.vline({ x: this.target, cls: "pd-rule-target" });
      c.series({ points: bp, cls: "pd-birth" });
      c.series({ points: dp, cls: "pd-death" });
      if (D.K != null && D.K <= xMax) {
        c.vline({ x: D.K, cls: "pd-rule-k", label: "K", labelCls: "pd-note-k" });
        c.dot({ x: D.K, y: D.dStar, cls: "pd-cross-dot" });
        c.note({ x: D.K, y: D.dStar, dy: -12, text: "births = deaths", cls: "pd-note-k" });
      }
      if (isFinite(Ncur) && Ncur <= xMax) c.vline({ x: Ncur, cls: "pd-rule-cursor" });
      c.note({ x: xMax * 0.06, y: p.b0, dy: -8, text: "b(N)", cls: "pd-note-birth", anchor: "start" });
      c.note({ x: xMax * 0.06, y: p.d0, dy: 14, text: "d(N)", cls: "pd-note-death", anchor: "start" });
      return c.render();
    },

    /* The fit, made visible. The logistic's per-capita growth rate is LINEAR in N,
       so the estimate is a straight line: y-intercept r, x-intercept K. Same fit as
       the dashed curve on the trajectory chart, drawn in the coordinates where it
       is a line rather than a curve. */
    fitChart: function (f, D) {
      if (!f) return h("p", "pd-empty", "Not enough censuses to fit a line. Count more often.");
      var i, xs = 0, pts = f.points;
      for (i = 0; i < pts.length; i++) xs = Math.max(xs, pts[i][0]);
      var xMax = Math.max(xs, D.K || 0, this.target || 0) * 1.12;
      var yLo = 0, yHi = 0;
      for (i = 0; i < pts.length; i++) { yLo = Math.min(yLo, pts[i][1]); yHi = Math.max(yHi, pts[i][1]); }
      yHi = Math.max(yHi, f.r, D.r) * 1.15;
      yLo = Math.min(yLo, 0) * 1.15;

      var c = chart({
        xDomain: [0, xMax], yDomain: [yLo, yHi],
        xLabel: "population size N", yLabel: "per-capita growth rate (/yr)",
        ariaLabel: "Per-capita growth rate against population size, with the fitted line",
        height: 260, yTickFmt: function (v) { return fmt(v, 2); }
      });
      // truth
      if (D.state === "ok") {
        c.series({ points: [[0, D.r], [xMax, D.r - D.dd * xMax]], cls: "pd-truth" });
      }
      // fit
      c.series({ points: [[0, f.r], [xMax, f.r + f.slope * xMax]], cls: "pd-fit" });
      c.dots({ points: pts, cls: "pd-census", r: 3 });
      c.dot({ x: 0, y: f.r, cls: "pd-fit-dot" });
      c.note({ x: 0, y: f.r, dx: 6, dy: -9, text: "intercept = r̂", cls: "pd-note-fit", anchor: "start" });
      if (f.K != null && f.K <= xMax) {
        c.dot({ x: f.K, y: 0, cls: "pd-fit-dot" });
        c.note({ x: f.K, y: 0, dy: 18, text: "crosses zero at K̂", cls: "pd-note-fit" });
      }
      return c.render();
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
          "On target. Write down your b₀ and d₀ — note that you never " +
          "set K, or the lifespan."));
      }
      return box;
    },

    /* The payoff: what you set, next to what a statistician could recover from the
       counts alone. The tick reads whether the truth falls inside the interval. */
    scorecard: function (D, f) {
      var wrap = h("div", "pd-scorecard-wrap");
      wrap.appendChild(h("h4", "pd-scorecard-title", "What the counts give back"));
      var t = h("table", "pd-scorecard");
      var html = "<thead><tr><th scope=\"col\">quantity</th><th scope=\"col\">you set</th>" +
                 "<th scope=\"col\">recovered from the counts</th><th scope=\"col\"></th></tr></thead><tbody>";

      function mark(ok) {
        return ok == null ? "" :
          ok ? "<span class=\"pd-ok\">✓</span>" : "<span class=\"pd-bad\">✗</span>";
      }
      function ci(lo, hi, digits) {
        return "<span class=\"pd-ci\">[" + fmt(lo, digits) + ", " + fmt(hi, digits) + "]</span>";
      }

      if (!f) {
        html += "<tr><td colspan=\"4\">" +
                (D.state === "declines"
                  ? "This population went extinct. There is no growth curve left to fit."
                  : "Not enough censuses to fit a line — count more often.") +
                "</td></tr>";
      } else {
        var rOk = f.rCI && f.rCI[0] <= D.r && D.r <= f.rCI[1];
        html += "<tr><th scope=\"row\">r <span class=\"pd-sc-sub\">intrinsic growth rate</span></th>" +
                "<td>" + fmt(D.r, 3) + "</td><td>" + fmt(f.r, 3) + " " +
                (f.rCI ? ci(f.rCI[0], f.rCI[1], 3) : "") + "</td><td>" + mark(rOk) + "</td></tr>";

        if (D.K == null) {
          html += "<tr><th scope=\"row\">K <span class=\"pd-sc-sub\">carrying capacity</span></th>" +
                  "<td>—</td><td>" +
                  (f.K == null ? "<em>not identifiable</em>" : sig3(f.K)) + "</td><td></td></tr>";
        } else if (f.K == null) {
          html += "<tr><th scope=\"row\">K <span class=\"pd-sc-sub\">carrying capacity</span></th>" +
                  "<td>" + sig3(D.K) + "</td>" +
                  "<td><em>not identifiable from this census</em></td><td></td></tr>";
        } else {
          var kOk = f.KCI && f.KCI[0] <= D.K && D.K <= f.KCI[1];
          html += "<tr><th scope=\"row\">K <span class=\"pd-sc-sub\">carrying capacity</span></th>" +
                  "<td>" + sig3(D.K) + "</td><td>" + sig3(f.K) + " " +
                  (f.KCI ? ci(f.KCI[0], f.KCI[1], 0) : "") + "</td><td>" + mark(kOk) + "</td></tr>";
        }
        html += "<tr><th scope=\"row\">b₀, d₀ <span class=\"pd-sc-sub\">the rates themselves</span></th>" +
                "<td>" + fmt(this.p.b0, 2) + ", " + fmt(this.p.d0, 2) + "</td>" +
                "<td><em>not recoverable — counts see only b − d</em></td><td></td></tr>";
      }
      t.innerHTML = html + "</tbody>";
      wrap.appendChild(t);

      if (f && f.K == null) {
        wrap.appendChild(h("p", "pd-scorecard-note",
          "The fitted line has not turned over, so these counts carry no information " +
          "about a carrying capacity. Printing a number here would be a guess with " +
          "three significant figures — which is the position every invasive-species " +
          "and early-outbreak projection starts from."));
      } else if (this.noise > 0) {
        wrap.appendChild(h("p", "pd-scorecard-note",
          "Noise here is measurement only — the population still followed the " +
          "smooth curve exactly. Even so, the recovered numbers drift: sampling error " +
          "flattens the fitted line, which pulls r̂ down and pushes K̂ up."));
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
