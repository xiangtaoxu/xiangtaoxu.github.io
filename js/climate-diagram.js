/*
  climate-diagram.js — the Global Climate Diagrams teaching page.

  Click the map, get a Walter–Lieth climate diagram for that point. Everything
  runs in the browser: one gzipped grid of 30-year monthly averages is fetched
  once at startup, and every diagram after that is drawn from memory.

  Written for BioEE 1610, so the wording throughout favours plain language over
  climatological jargon ("dry season", not "arid period").

  Layout of the file:
    CONFIG        constants that are safe to tweak
    grid          fetch + decode + sample the climate data
    walterLieth   turn 12 temperatures and 12 rainfalls into an <svg>
    ui            Leaflet map, controls, panel, URL permalink

  No build step, no bundler, no dependencies beyond Leaflet.
*/

(function () {
  "use strict";

  // ---------------------------------------------------------------- CONFIG

  var CONFIG = {
    manifest: "/data/climate/manifest.json",
    basemap: "/images/basemap/world-ne2.jpg",

    // Where the page opens. Ithaca: the students' own campus is the least
    // abstract possible starting point for a first climate diagram.
    home: { lat: 42.44, lon: -76.5, name: "Ithaca, New York" },

    // Above this much within-cell elevation range, the diagram warns that a
    // 0.5° average is hiding real variation. Tuned by eye against the data:
    // the median land cell is ~380 m, Quito's is ~2800 m.
    reliefWarn: 500,

    // The image is 4096 px wide and Leaflet's EPSG4326 world is 512·2^z px, so
    // 1:1 falls at z=3. One stop past that is as far as it is honest to go.
    maxZoom: 4,

    // Biome exemplars. Clicking down this list in order is, roughly, the
    // biomes lecture — which is why the labels lead with the biome, not the
    // place name.
    presets: [
      { label: "Tropical rainforest — Manaus, Brazil", lat: -3.1, lon: -60.02 },
      { label: "Tropical savanna — Darwin, Australia", lat: -12.46, lon: 130.84 },
      { label: "Hot desert — Cairo, Egypt", lat: 30.05, lon: 31.23 },
      { label: "Mediterranean — Rome, Italy", lat: 41.9, lon: 12.5 },
      { label: "Temperate deciduous — Ithaca, New York", lat: 42.44, lon: -76.5 },
      { label: "Boreal forest — Yakutsk, Russia", lat: 62.03, lon: 129.73 },
      { label: "Tundra — Utqiaġvik, Alaska", lat: 71.29, lon: -156.79 },
      { label: "Tropical highland — Nairobi, Kenya", lat: -1.29, lon: 36.82 }
    ]
  };

  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var SVG_NS = "http://www.w3.org/2000/svg";

  // ------------------------------------------------------------------ grid

  var grid = {
    meta: null,
    data: null,

    load: function () {
      var self = this;
      return fetch(CONFIG.manifest)
        .then(function (r) {
          if (!r.ok) throw new Error("manifest " + r.status);
          return r.json();
        })
        .then(function (meta) {
          self.meta = meta;
          var base = CONFIG.manifest.replace(/[^/]*$/, "");
          return fetch(base + meta.file.path);
        })
        .then(function (r) {
          if (!r.ok) throw new Error("grid " + r.status);
          return r.arrayBuffer();
        })
        .then(function (buf) {
          // If the server set Content-Encoding: gzip the browser already
          // decompressed this, and a second pass would throw — so decide by
          // looking for the gzip magic number rather than trusting headers.
          var head = new Uint8Array(buf, 0, 2);
          if (head[0] === 0x1f && head[1] === 0x8b) {
            return new Response(
              new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))
            ).arrayBuffer();
          }
          return buf;
        })
        .then(function (raw) {
          self.data = new Int16Array(raw);
          return self;
        });
    },

    // Everything below reads its constants from the manifest, so regenerating
    // the grid at another resolution needs no change here.
    sample: function (lat, lon) {
      var g = this.meta.grid, p = this.meta.planes;
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;   // wrap across the dateline
      if (lat > g.lat_max || lat < g.lat_max - 180) return null;

      var col = Math.floor((lon - g.lon_min) / g.res_deg);
      var row = Math.floor((g.lat_max - lat) / g.res_deg);
      if (col < 0 || col >= g.nx || row < 0 || row >= g.ny) return null;

      var n = g.nx * g.ny, at = row * g.nx + col;
      var elev = this.data[p.elev.index * n + at];
      if (elev === g.nodata) return null;

      var tavg = [], prec = [], i;
      for (i = 0; i < 12; i++) {
        tavg.push(this.data[(p.tavg.index + i) * n + at] / p.tavg.scale);
        prec.push(this.data[(p.prec.index + i) * n + at] / p.prec.scale);
      }
      return {
        lat: lat, lon: lon,
        elev: elev / p.elev.scale,
        relief: this.data[p.elev_range.index * n + at] / p.elev_range.scale,
        tavg: tavg,
        prec: prec,
        // The snapped cell — what the numbers actually describe. Both the map
        // rectangle and the figure caption are drawn from this.
        cell: {
          north: g.lat_max - row * g.res_deg,
          south: g.lat_max - (row + 1) * g.res_deg,
          west: g.lon_min + col * g.res_deg,
          east: g.lon_min + (col + 1) * g.res_deg,
          size: g.res_deg
        }
      };
    }
  };

  // ----------------------------------------------------------- walterLieth

  // Walter–Lieth couples the two axes: 10 °C lines up with 20 mm, until 100 mm,
  // above which 10 °C lines up with 200 mm. Both curves are therefore drawn in
  // one shared coordinate ("u", in °C units) and only the labels differ.
  function precToU(mm) { return mm <= 100 ? mm / 2 : 50 + (mm - 100) / 20; }
  function uToPrec(u) { return u <= 50 ? u * 2 : 100 + (u - 50) * 20; }

  function el(name, attrs, text) {
    var e = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  // Insert the exact crossing points where two series swap order, so the
  // shaded areas meet the curves cleanly instead of stepping at month centres.
  function densify(xs, a, b) {
    var X = [], A = [], B = [], i;
    for (i = 0; i < xs.length; i++) {
      X.push(xs[i]); A.push(a[i]); B.push(b[i]);
      if (i < xs.length - 1) {
        var d0 = a[i] - b[i], d1 = a[i + 1] - b[i + 1];
        if ((d0 > 0 && d1 < 0) || (d0 < 0 && d1 > 0)) {
          var t = d0 / (d0 - d1);
          X.push(xs[i] + t * (xs[i + 1] - xs[i]));
          var y = a[i] + t * (a[i + 1] - a[i]);
          A.push(y); B.push(y);
        }
      }
    }
    return { X: X, A: A, B: B };
  }

  function bands(d, wantAbove, toX, toY) {
    var out = [], run = [], i;
    function flush() {
      if (run.length > 1) {
        var fwd = run.map(function (j) { return toX(d.X[j]) + "," + toY(d.A[j]); });
        var bwd = run.slice().reverse().map(function (j) { return toX(d.X[j]) + "," + toY(d.B[j]); });
        out.push("M" + fwd.join("L") + "L" + bwd.join("L") + "Z");
      }
      run = [];
    }
    for (i = 0; i < d.X.length; i++) {
      var diff = d.A[i] - d.B[i];
      if (wantAbove ? diff >= 0 : diff <= 0) run.push(i); else flush();
    }
    flush();
    return out;
  }

  function fmtCoord(lat, lon) {
    return Math.abs(lat).toFixed(2) + "° " + (lat >= 0 ? "N" : "S") + ", " +
           Math.abs(lon).toFixed(2) + "° " + (lon >= 0 ? "E" : "W");
  }

  function walterLieth(site, meta, title) {
    var W = 620;
    var M = { top: 78, right: 62, left: 62 };
    var plotW = W - M.left - M.right, plotH = 256;

    // Southern hemisphere diagrams start in July, so the warm season sits in
    // the middle of the chart the way it does for a northern one. This is the
    // standard convention and the axis is labelled so it reads as deliberate.
    var south = site.lat < 0;
    var order = [], i;
    for (i = 0; i < 12; i++) order.push(south ? (i + 6) % 12 : i);
    var T = order.map(function (m) { return site.tavg[m]; });
    var P = order.map(function (m) { return site.prec[m]; });
    var labels = order.map(function (m) { return MONTHS[m].charAt(0); });

    var mat = T.reduce(function (a, b) { return a + b; }, 0) / 12;
    var map_ = P.reduce(function (a, b) { return a + b; }, 0);

    // Caption lines are assembled first: how many there are decides how tall the
    // figure needs to be. They live inside the SVG because there are no download
    // buttons — students screenshot, and the caveats must travel with the image.
    var caption = [{
      text: "Averaged over a " + site.cell.size + "° grid cell (about 55 km north–south) centred at " +
            fmtCoord((site.cell.north + site.cell.south) / 2, (site.cell.west + site.cell.east) / 2) + ".",
      warn: false
    }];
    if (south) {
      caption.push({
        text: "Months run July–June, so summer falls in the middle of the chart (southern hemisphere).",
        warn: false
      });
    }
    if (site.relief >= CONFIG.reliefWarn) {
      caption.push({
        text: "Land inside this cell varies by about " + Math.round(site.relief) +
              " m in elevation, so conditions differ a lot",
        warn: true
      });
      caption.push({
        text: "between valley and ridge — treat this as a regional average, not a local measurement.",
        warn: true
      });
    }
    var capTop = M.top + plotH + 38;
    var H = capTop + (caption.length - 1) * 14 + 16;

    var uP = P.map(precToU);
    var uMin = Math.min(0, Math.floor(Math.min.apply(null, T) / 10) * 10);
    var uMax = Math.max(50, Math.ceil(Math.max(Math.max.apply(null, T),
                                               Math.max.apply(null, uP)) / 10) * 10);

    var toX = function (m) { return M.left + (m + 0.5) * (plotW / 12); };
    var toY = function (u) { return M.top + plotH * (1 - (u - uMin) / (uMax - uMin)); };
    var xs = []; for (i = 0; i < 12; i++) xs.push(i);

    var svg = el("svg", {
      viewBox: "0 0 " + W + " " + H,
      class: "cd-chart",
      role: "img",
      "aria-label": title + ": mean annual temperature " + mat.toFixed(1) +
                    " degrees Celsius, annual precipitation " + Math.round(map_) +
                    " millimetres. Monthly values are in the table below."
    });

    var defs = el("defs");
    var dry = el("pattern", { id: "cd-dry", width: 6, height: 6, patternUnits: "userSpaceOnUse" });
    dry.appendChild(el("circle", { cx: 1.5, cy: 1.5, r: 0.9, class: "cd-dry-dot" }));
    var wet = el("pattern", { id: "cd-wet", width: 5, height: 5, patternUnits: "userSpaceOnUse" });
    wet.appendChild(el("path", { d: "M0,5 L5,0", class: "cd-wet-line" }));
    defs.appendChild(dry); defs.appendChild(wet);
    svg.appendChild(defs);

    // --- shaded seasons, drawn under the curves ---
    var d = densify(xs, uP, T);
    bands(d, false, toX, toY).forEach(function (p) {          // rain below temp
      svg.appendChild(el("path", { d: p, fill: "url(#cd-dry)", class: "cd-band" }));
    });
    bands(d, true, toX, toY).forEach(function (p) {           // rain above temp
      svg.appendChild(el("path", { d: p, fill: "url(#cd-wet)", class: "cd-band" }));
    });
    var cap = xs.map(function () { return 50; });             // the 100 mm line
    bands(densify(xs, uP, cap), true, toX, toY).forEach(function (p) {
      svg.appendChild(el("path", { d: p, class: "cd-verywet" }));
    });

    // --- axes ---
    for (var u = uMin; u <= uMax; u += 10) {
      var y = toY(u);
      svg.appendChild(el("line", {
        x1: M.left, x2: W - M.right, y1: y, y2: y,
        class: u === 0 ? "cd-axis-zero" : "cd-gridline"
      }));
      svg.appendChild(el("text", { x: M.left - 9, y: y + 4, class: "cd-tick cd-tick-t" }, String(u)));
      svg.appendChild(el("text", { x: W - M.right + 9, y: y + 4, class: "cd-tick cd-tick-p" },
                        u < 0 ? "" : String(Math.round(uToPrec(u)))));
    }
    svg.appendChild(el("line", { x1: M.left, x2: M.left, y1: M.top, y2: M.top + plotH, class: "cd-axis" }));
    svg.appendChild(el("line", { x1: W - M.right, x2: W - M.right, y1: M.top, y2: M.top + plotH, class: "cd-axis" }));

    // The 1:2 → 1:20 scale break is the single most confusing thing on this
    // chart for a beginner, so it gets its own visible marker and a label.
    if (uMax > 50) {
      svg.appendChild(el("line", {
        x1: M.left, x2: W - M.right, y1: toY(50), y2: toY(50), class: "cd-break"
      }));
      svg.appendChild(el("text", { x: W - M.right - 6, y: toY(50) - 6, class: "cd-break-label" },
                       "scale changes here"));
    }

    for (i = 0; i < 12; i++) {
      svg.appendChild(el("text", { x: toX(i), y: M.top + plotH + 18, class: "cd-month" }, labels[i]));
    }

    svg.appendChild(el("text", { x: 14, y: M.top + plotH / 2, class: "cd-axis-title",
                                 transform: "rotate(-90 14 " + (M.top + plotH / 2) + ")" },
                       "Temperature (°C)"));
    svg.appendChild(el("text", { x: W - 12, y: M.top + plotH / 2, class: "cd-axis-title",
                                 transform: "rotate(90 " + (W - 12) + " " + (M.top + plotH / 2) + ")" },
                       "Precipitation (mm)"));

    // --- curves ---
    function line(vals, cls) {
      return el("path", {
        d: "M" + vals.map(function (v, m) { return toX(m) + "," + toY(v); }).join("L"),
        class: cls
      });
    }
    svg.appendChild(line(uP, "cd-prec-line"));
    svg.appendChild(line(T, "cd-temp-line"));

    // --- header ---
    svg.appendChild(el("text", { x: M.left, y: 24, class: "cd-title" }, title));
    svg.appendChild(el("text", { x: M.left, y: 44, class: "cd-subtitle" },
      fmtCoord(site.lat, site.lon) + "   ·   " + Math.round(site.elev) + " m above sea level"));
    svg.appendChild(el("text", { x: M.left, y: 62, class: "cd-stats" },
      mat.toFixed(1) + " °C mean annual temperature   ·   " +
      Math.round(map_) + " mm total annual rainfall"));
    svg.appendChild(el("text", { x: W - M.right, y: 24, class: "cd-period" },
      meta.dataset.period + " average"));
    svg.appendChild(el("text", { x: W - M.right, y: 42, class: "cd-period" },
      meta.dataset.name + " " + meta.dataset.version));

    // --- caption ---
    caption.forEach(function (line, i) {
      svg.appendChild(el("text", {
        x: M.left, y: capTop + i * 14,
        class: "cd-caption" + (line.warn ? " cd-caption-warn" : "")
      }, line.text));
    });

    return { svg: svg, mat: mat, map: map_, order: order, T: T, P: P, labels: labels };
  }

  // -------------------------------------------------------------------- ui

  var ui = {
    map: null, marker: null, cellBox: null, panel: null, statusEl: null, current: null,

    boot: function () {
      this.panel = document.getElementById("cd-panel");
      this.buildControls();
      this.buildMap();

      var self = this;
      this.status("Loading climate data…");
      grid.load().then(function () {
        self.status(null);
        var start = self.fromHash() || CONFIG.home;
        self.select(start.lat, start.lon, start.name, true);
      }).catch(function (err) {
        // The most likely cause in practice is the data file not being
        // published, so say something a maintainer can act on.
        self.status("Could not load the climate data (" + err.message + "). " +
                    "The map still works, but diagrams are unavailable.");
      });
    },

    status: function (msg) {
      if (!this.statusEl) {
        this.statusEl = document.createElement("p");
        this.statusEl.className = "cd-status";
        this.panel.appendChild(this.statusEl);
      }
      this.statusEl.textContent = msg || "";
      this.statusEl.style.display = msg ? "" : "none";
    },

    buildControls: function () {
      var host = document.getElementById("cd-controls"), self = this;

      var pick = document.createElement("label");
      pick.className = "cd-field";
      pick.innerHTML = "<span>Jump to a biome</span>";
      var sel = document.createElement("select");
      sel.innerHTML = '<option value="">Choose an example…</option>';
      CONFIG.presets.forEach(function (p, i) {
        var o = document.createElement("option");
        o.value = String(i); o.textContent = p.label;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () {
        if (sel.value === "") return;
        var p = CONFIG.presets[+sel.value];
        self.select(p.lat, p.lon, p.label.split(" — ")[1], true);
      });
      pick.appendChild(sel);
      host.appendChild(pick);

      // Typed coordinates are the keyboard and screen-reader path to every
      // point on the map, which a click handler alone cannot offer.
      var form = document.createElement("form");
      form.className = "cd-field cd-coords";
      form.innerHTML =
        "<span>Or enter coordinates</span>" +
        '<input type="number" id="cd-lat" step="0.01" min="-90" max="90" value="42.44" aria-label="Latitude in degrees, positive north">' +
        '<input type="number" id="cd-lon" step="0.01" min="-180" max="180" value="-76.50" aria-label="Longitude in degrees, positive east">' +
        '<button type="submit" class="btn btn-sm">Show</button>';
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var la = parseFloat(document.getElementById("cd-lat").value);
        var lo = parseFloat(document.getElementById("cd-lon").value);
        if (isFinite(la) && isFinite(lo)) self.select(la, lo, null, true);
      });
      host.appendChild(form);
    },

    buildMap: function () {
      var bounds = [[-90, -180], [90, 180]];
      var map = L.map("cd-map", {
        crs: L.CRS.EPSG4326,
        maxZoom: CONFIG.maxZoom,
        maxBounds: bounds,
        maxBoundsViscosity: 1,
        worldCopyJump: false,
        attributionControl: true
      });
      L.imageOverlay(CONFIG.basemap, bounds, { alt: "" }).addTo(map);
      // Attribution lives on the control, not on the map — L.Map has no
      // addAttribution method, and calling one throws before fitBounds runs.
      map.attributionControl.setPrefix("").addAttribution(
        'Basemap: <a href="https://www.naturalearthdata.com/">Natural Earth II</a> (public domain)'
      );
      map.fitBounds(bounds);
      map.setMinZoom(map.getZoom());

      var self = this;
      map.on("click", function (e) { self.select(e.latlng.lat, e.latlng.lng, null, true); });
      this.map = map;
    },

    fromHash: function () {
      var m = /lat=(-?[\d.]+)&lon=(-?[\d.]+)/.exec(location.hash);
      if (!m) return null;
      var la = parseFloat(m[1]), lo = parseFloat(m[2]);
      return isFinite(la) && isFinite(lo) ? { lat: la, lon: lo, name: null } : null;
    },

    select: function (lat, lon, name, pan) {
      if (!grid.data) return;
      var site = grid.sample(lat, lon);

      document.getElementById("cd-lat").value = lat.toFixed(2);
      document.getElementById("cd-lon").value = lon.toFixed(2);
      // replaceState, not pushState: the back button should leave the page,
      // not walk back through every click a student made.
      history.replaceState(null, "", "#lat=" + lat.toFixed(2) + "&lon=" + lon.toFixed(2));

      this.drawMarker(lat, lon, site);
      if (pan && this.map) this.map.panTo([lat, lon], { animate: true });

      if (!site) {
        this.render(null, null);
        return;
      }
      this.render(site, name || fmtCoord(site.lat, site.lon));
    },

    drawMarker: function (lat, lon, site) {
      if (this.marker) this.map.removeLayer(this.marker);
      if (this.cellBox) this.map.removeLayer(this.cellBox);

      // The rectangle is the honest marker: it is the area the numbers
      // describe. The dot only records where the click actually landed.
      if (site) {
        this.cellBox = L.rectangle(
          [[site.cell.south, site.cell.west], [site.cell.north, site.cell.east]],
          { className: "cd-cell", weight: 1.5, fillOpacity: 0.12, interactive: false }
        ).addTo(this.map);
      }
      this.marker = L.circleMarker([lat, lon], {
        radius: 4, className: "cd-pin", interactive: false
      }).addTo(this.map);
    },

    render: function (site, title) {
      this.panel.innerHTML = "";
      this.panel.appendChild(this.statusEl);

      if (!site) {
        var p = document.createElement("p");
        p.className = "cd-empty";
        p.textContent = "No land data here — try clicking on land.";
        this.panel.appendChild(p);
        return;
      }

      var out = walterLieth(site, grid.meta, title);
      this.panel.appendChild(out.svg);
      this.panel.appendChild(this.legend());
      this.panel.appendChild(this.table(out));
    },

    legend: function () {
      var d = document.createElement("ul");
      d.className = "cd-legend";
      d.innerHTML =
        '<li><span class="cd-key cd-key-temp"></span>Temperature</li>' +
        '<li><span class="cd-key cd-key-prec"></span>Rainfall</li>' +
        '<li><span class="cd-key cd-key-dry"></span>Dry season</li>' +
        '<li><span class="cd-key cd-key-wet"></span>Wet season</li>' +
        '<li><span class="cd-key cd-key-verywet"></span>Very wet (over 100 mm)</li>';
      return d;
    },

    // The table is the accessible version of the chart, and it is what a
    // student will copy into a spreadsheet for a lab exercise.
    table: function (out) {
      var wrap = document.createElement("div");
      wrap.className = "cd-table-wrap";
      var t = document.createElement("table");
      t.className = "cd-table";
      var head = "<tr><th scope=\"row\">Month</th>";
      var rowT = "<tr><th scope=\"row\">Temp (°C)</th>";
      var rowP = "<tr><th scope=\"row\">Rain (mm)</th>";
      for (var i = 0; i < 12; i++) {
        head += "<th>" + MONTHS[out.order[i]] + "</th>";
        rowT += "<td>" + out.T[i].toFixed(1) + "</td>";
        rowP += "<td>" + Math.round(out.P[i]) + "</td>";
      }
      t.innerHTML = "<caption>Monthly values for this grid cell</caption>" +
                    head + "</tr>" + rowT + "</tr>" + rowP + "</tr>";
      wrap.appendChild(t);
      return wrap;
    }
  };

  if (document.getElementById("cd-map")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { ui.boot(); });
    } else {
      ui.boot();
    }
  }
})();
