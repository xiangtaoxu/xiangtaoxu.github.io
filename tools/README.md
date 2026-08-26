# tools/

One-off scripts. Nothing here runs during `quarto render` or in CI — the site
has no build step. Run these by hand when the underlying data changes, and
commit the output.

## `build_climate_grid.py`

Builds the grid behind the [Global Climate Diagrams](../teaching/climate-diagram.qmd)
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
