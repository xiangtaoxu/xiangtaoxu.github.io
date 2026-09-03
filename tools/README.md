# tools/

One-off scripts. Nothing here runs during `quarto render` or in CI — the site has
no build step. Run them by hand when you need them.

**Whether the output is committed differs per script, and it is deliberate:**

| script | what it does | output | committed? |
|---|---|---|---|
| [`build_climate_grid.py`](#build_climate_gridpy) | builds the climate grid the diagrams sample | `data/climate/` | **yes** — the site serves it |
| [`check_photosynthesis.py`](#check_photosynthesispy) | verifies the JS leaf model against the Fortran it was ported from | none (exit status) | n/a |
| [`sync_visitor_stats.py`](#sync_visitor_statspy) | copies visitor counts off goatcounter.com | `analytics/` | **no** — this repo is public and the numbers are private |
| [`make_qr.py`](#make_qrpy) | generates a static QR code for the site | `qr/` | **no** — derived, regenerates in a second |

Each `no` is enforced by a rule in `.gitignore`, with the reason written next to it.

## `build_climate_grid.py`

Builds the grid behind the [Global Climate Diagrams](../teaching/bioee1610/climate-diagram.qmd)
page: one gzipped binary array plus a JSON manifest, together about 2.5 MB, which
the browser downloads once and then samples locally.

```bash
conda activate website          # or any env with numpy + rasterio
python tools/build_climate_grid.py
```

Sources are downloaded to `.worldclim-cache/` (git-ignored) on first run and
reused after that. Set `WORLDCLIM_CACHE` to point somewhere else.

### What it downloads

| file | why |
|---|---|
| `wc2.1_10m_tavg.zip` | 12 monthly mean temperatures |
| `wc2.1_10m_prec.zip` | 12 monthly precipitation totals |
| `wc2.1_2.5m_elev.zip` | elevation — see below |

About 60 MB in total, once.

### Why elevation comes in at a finer resolution

The climate variables are read at 10 arc-minutes and block-averaged down to the
0.5° output grid. Elevation is read at **2.5 arc-minutes** instead, because it
feeds two different things:

- the **cell mean elevation**, shown in the diagram header; and
- the **elevation range within the cell**, which drives the diagram's warning
  that a 55 km average is hiding real variation.

That second one is a measure of exactly the variability that averaging destroys,
so it has to be measured before the averaging, and as finely as we can afford.
At 2.5′ each output cell sees 12×12 = 144 samples; at 10′ it would see 3×3 = 9,
which is too few to distinguish a valley floor from a mountain range.

Even 2.5′ elevation is itself a cell average, so the reported range **understates**
true relief. That is the safe direction to be wrong in.

### Output format

`data/climate/world-30min.bin.gz` — 26 planes of `int16`, band-sequential,
little-endian, 720×360 each, row 0 at the north pole, column 0 at 180° W:

```
plane  0        elevation, cell mean (m)
planes 1  – 12  mean temperature, Jan..Dec  (0.1 °C)
planes 13 – 24  precipitation,    Jan..Dec  (mm)
plane  25       elevation range within the cell (m)
```

`-32768` means no data (ocean). `data/climate/manifest.json` carries every
constant the client needs — grid geometry, scale factors, plane indices,
provenance — so `js/climate-diagram.js` hardcodes none of them. Regenerating at
a different resolution requires no JavaScript change.

### Licence — current status

WorldClim's terms (<https://worldclim.org/about.html>) say:

> The data are freely available for academic use and other non-commercial use.
> **Redistribution or commercial use is not allowed without prior permission.**

Running this script locally is ordinary academic use. Publishing `data/climate/`
to the website is *redistribution* of a derived product — non-commercial purpose
does not cover it, because redistribution is prohibited as its own act.

**Status:** permission was requested from <info@worldclim.org> on 2026-08-25 for
this specific derived product (monthly tavg + precipitation aggregated from 10
arc-minutes to 0.5°, requantized to int16, ~2.5 MB, served static so diagrams can
be drawn client-side). **No reply yet.** The data is published in the meantime,
on the understanding that it comes down promptly if permission is declined.
WorldClim 2.1 is cited on the page and in `manifest.json`.

### If permission is declined — taking it down

Removing it from the live site is one commit:

```bash
git rm -r --cached data/climate
printf '\n/data/climate/\n' >> .gitignore
git commit -m "Remove WorldClim-derived grid pending redistribution permission"
git push origin main          # CI redeploys without it
```

The page degrades on its own: it loads, the map works, and it reports that
climate data is unavailable. No code change is needed.

Two things that commit does **not** do, in case WorldClim asks for more:

- the file stays in this repo's **git history** (and in `gh-pages` history), which
  is public. Purging it needs a history rewrite plus a force push;
- caches and mirrors outside our control may retain it for a while.

The durable fix is to repoint the reading stage of this script at a source that
permits redistribution. The binary format, the manifest, and the entire client
are dataset-agnostic, so nothing else changes — roughly twenty lines here.
CHELSA is the obvious candidate; check its licence first.

## `check_photosynthesis.py`

Verifies [`js/photosynthesis-model.js`](../js/photosynthesis-model.js) against the
MEDS Fortran kernel it was ported from. The [Photosynthesis](../teaching/bioee1610/photosynthesis.qmd)
page claims to run the lab's research leaf model; this is what makes that claim
checkable.

```bash
conda activate website                        # for deno
python tools/check_photosynthesis.py          # full run
python tools/check_photosynthesis.py --no-fortran   # property checks only
```

The same grid of cases goes through the compiled Fortran (via the MEDS Python
C-API) and through the JavaScript (via deno), and the two must agree. Two entry
points are checked *separately*, because section 1 of the page uses one and
sections 2–3 use the other, and a bug in one must not hide behind the other:

| check | what it exercises | page section |
|---|---|---|
| `demand` | `assimilation_demand_c3` at a prescribed Ci, stomata bypassed | 1 |
| `coupled` | `solve_leaf_gas_exchange`, the full A–gs–Ci solve with Medlyn stomata | 2 and 3 |

CAM and the diurnal driver have no Fortran counterpart — they are not ports — so
they get property assertions instead, which still trip on a regression.

Needs `libmeds_plant_c` built from a MEDS **v0.1.0** checkout (see MEDS
`python/README.md`). Without it the script says so and falls back to property
checks, which are a strictly weaker guarantee; it will not pretend otherwise in
its exit status.

## `sync_visitor_stats.py`

Copies the visitor counts from goatcounter.com into local CSVs. The counts live
on someone else's server, which means **their copy is the only copy** — this makes
a local one, so a lapsed service, a deleted account or a changed retention setting
can't take the record with it. Run it at the end of each term.

```bash
# One-time: create a token at https://xiangtaoxu.goatcounter.com/user/api
# with the "Read statistics" permission (that exact label), then either:
export GOATCOUNTER_API_TOKEN=...
#   or store it once, keeping it out of shell history:
mkdir -p ~/.config/goatcounter && chmod 700 ~/.config/goatcounter
(umask 077; read -rsp 'Paste token: ' t && printf '%s' "$t" > ~/.config/goatcounter/token; unset t; echo)

python tools/sync_visitor_stats.py --check    # verify the token, write nothing
python tools/sync_visitor_stats.py            # sync everything, all time
python tools/sync_visitor_stats.py --start 2026-09-01 --end 2026-12-31
```

Writes two files, both regenerated from scratch each run so re-running is safe:

| file | contents |
|---|---|
| `analytics/visitors-by-path.csv` | one row per page — each Teaching tool page's row is that activity card's count |
| `analytics/visitors-daily.csv` | long format (`day, path, visitors`) — full history, for plotting a term or diffing two runs |

The token is read from `$GOATCOUNTER_API_TOKEN` or a file, never from a
command-line argument, where it would land in shell history and `ps` output.
Standard library only — no `conda activate` needed.

**What the numbers mean.** GoatCounter stores *visitors*, not raw pageviews:
deduplicated per IP + browser over an 8-hour window. Two students behind one
campus NAT on the same browser build can collapse into a single visitor, and
ad-blockers cut the total further, so **treat every figure as a lower bound.**
Say "distinct browsers", not "people", in anything a sceptical reader will see.

401 means the token is wrong; 403 means it exists but lacks "Read statistics".

## `make_qr.py`

Generates a **static** QR code for the site — SVG for print, PNG for slides.

```bash
pip install segno                             # pure Python, no system libraries

python tools/make_qr.py                       # the site, EC level M
python tools/make_qr.py --github              # the durable target, see below
python tools/make_qr.py --upper               # smaller symbol, see below
python tools/make_qr.py --ec q                # tolerates scuffing or a logo
python tools/make_qr.py --src poster-esa2026  # tag scans in GoatCounter
python tools/make_qr.py --url https://example.org/x --name whatever
```

### Why not a QR website

Most free generators hand back a *dynamic* code: the bitmap encodes **their**
domain and redirects to yours. That buries a permanent third-party dependency
inside a printed object — when the service expires, caps scans or goes paid, every
poster already on a wall stops working. A static code encodes the URL itself: no
account, no provider, nothing to renew.

The test for any generator: scan its output. If the URL that appears is yours it
is static and safe; if it is the generator's domain, discard it.

### Which URL to encode — the actual long-term decision

| target | trade-off |
|---|---|
| `xiangtaoxu.eeb.cornell.edu` (default) | reads better on a poster, but it is Cornell EEB's DNS zone — if you move institutions, printed codes die |
| `xiangtaoxu.github.io` (`--github`) | tied to the GitHub account, so it survives a move. Currently 301s to the custom domain; if that hostname went away, deleting `CNAME` makes it serve directly |

For something printed to last, prefer `--github`. For a conference poster this
season, the default looks better. A printed code cannot be edited, so choose
deliberately rather than by default.

### `--upper`, and why it is refused for paths

Uppercasing a bare domain switches the encoder from byte mode into QR's
*alphanumeric* mode, dropping a version — 37×37 to 33×33 for this domain — so the
modules are ~16% larger at the same printed size and scan from further away. It is
safe because URL schemes and DNS hostnames are both case-insensitive.

It is **refused** for any URL carrying a path or query. Those are case-sensitive on
GitHub Pages, so uppercasing one would produce a code that resolves to a 404.

### Printing

Each run reports the symbol version, encoding mode, and a recommended width for
three scan distances (rule of thumb: width ≈ scan distance ÷ 10, and below about
0.4 mm per module phone cameras start to struggle).

- **Use the SVG for anything printed.** The PNG is for slides.
- **Dark on light only.** Inverted codes fail on many scanners, so don't set one on
  a carnelian background.
- Keep the quiet zone. The script always writes the mandatory 4-module border;
  plenty of web generators crop it and produce codes that scan unreliably.
- **Don't URL-shorten.** That reintroduces exactly the dependency a static code avoids.

### Verification

Every run decodes the result and reports whether it encodes the intended URL. That
check reads a *temporary* render rather than the output PNG, deliberately: OpenCV's
detector returns empty for certain specific pixel sizes on codes that are perfectly
valid — a 41-module symbol at scale 39 fails while 4, 8, 10, 20 and 50 all pass — so
validating the output file's dimensions would raise false alarms about good codes.
What matters is the encoded content, which is scale-invariant.

`cv2` is optional; without it the script says the code is unverified rather than
implying it passed. Either way, **scan the result with a phone once before sending
it to a printer.** That takes five seconds and is the only check that fully counts.
