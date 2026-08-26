#!/usr/bin/env python3
"""
build_climate_grid.py -- turn WorldClim 2.1 rasters into the single binary grid
that the Global Climate Diagrams teaching page reads in the browser.

Run this BY HAND when the source data changes. It is never run by `quarto
render` and never by CI -- the site has no build step, so its output
(data/climate/*) is committed as-is.

    conda activate website          # or any env with numpy + rasterio
    python tools/build_climate_grid.py

See tools/README.md for what it downloads, and for the licence question that
governs whether the OUTPUT may be committed at all.

Output
------
data/climate/world-30min.bin.gz   26 planes of int16, band-sequential
data/climate/manifest.json        everything the client needs to read it

The client hardcodes no grid constants; it reads them from the manifest.
"""

from __future__ import annotations

import gzip
import json
import sys
import zipfile
from datetime import date
from pathlib import Path
from urllib.request import urlopen

import numpy as np
import rasterio

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

BASE_URL = "https://geodata.ucdavis.edu/climate/worldclim/2_1/base"

# Working resolution. WorldClim's coarsest offering is 10 arc-minutes, so the
# climate variables come in at 10m and get block-averaged down.
CLIMATE_RES = "10m"

# Elevation is read at 2.5 arc-minutes, NOT 10m, and only for the terrain-range
# plane. That plane exists to warn students where a 0.5 deg cell hides a lot of
# relief (see the plan's "Being honest about 55 km"), and its whole value is the
# variability that averaging destroys -- so it must be measured as finely as we
# can afford. At 2.5m each output cell sees 12x12 = 144 samples instead of the
# 3x3 = 9 that 10m would give.
ELEV_RES = "2.5m"

OUT_DEG = 0.5  # output cell size -> 720 x 360

NODATA = -32768  # int16 sentinel, shared by every plane

# Scale factors: stored_value = real_value * scale. int16 headroom is ample --
# 0.1 degC resolution tops out at +-3276 degC, monthly rainfall at 32767 mm.
SCALE_TEMP = 10  # 0.1 degC
SCALE_PREC = 1  # mm
SCALE_ELEV = 1  # m

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "data" / "climate"
CACHE = Path(
    __import__("os").environ.get("WORLDCLIM_CACHE", REPO / ".worldclim-cache")
)

DATASET = {
    "name": "WorldClim",
    "version": "2.1",
    "period": "1970-2000",
    "citation": (
        "Fick, S.E. and R.J. Hijmans, 2017. WorldClim 2: new 1km spatial "
        "resolution climate surfaces for global land areas. International "
        "Journal of Climatology 37 (12): 4302-4315."
    ),
    "url": "https://worldclim.org/data/worldclim21.html",
}


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------


def fetch(name: str) -> Path:
    """Download <name>.zip into the cache unless it is already there."""
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / f"{name}.zip"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    url = f"{BASE_URL}/{name}.zip"
    print(f"  downloading {url}")
    with urlopen(url) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    return dest


def read_tif(zip_path: Path, member: str) -> tuple[np.ndarray, float]:
    """Read one GeoTIFF out of a zip without unpacking the whole archive."""
    with zipfile.ZipFile(zip_path) as z, z.open(member) as fh:
        with rasterio.io.MemoryFile(fh.read()) as mem, mem.open() as ds:
            return ds.read(1), ds.nodata


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------


def block_mean(a: np.ndarray, valid: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Mean of each k x k block over valid cells only.

    Returns (mean, count). Blocks with no valid cell get mean 0 and count 0 --
    callers decide what that means, because "no data" is a per-plane question.
    """
    ny, nx = a.shape[0] // k, a.shape[1] // k
    vals = np.where(valid, a, 0).astype(np.float64).reshape(ny, k, nx, k)
    cnts = valid.reshape(ny, k, nx, k)
    total = vals.sum(axis=(1, 3))
    count = cnts.sum(axis=(1, 3))
    return np.divide(total, count, out=np.zeros_like(total), where=count > 0), count


def block_range(a: np.ndarray, valid: np.ndarray, k: int) -> np.ndarray:
    """max - min within each k x k block, over valid cells only."""
    ny, nx = a.shape[0] // k, a.shape[1] // k
    big = np.where(valid, a, -np.inf).astype(np.float64).reshape(ny, k, nx, k)
    small = np.where(valid, a, np.inf).astype(np.float64).reshape(ny, k, nx, k)
    hi = big.max(axis=(1, 3))
    lo = small.min(axis=(1, 3))
    out = hi - lo
    return np.where(np.isfinite(out), out, 0.0)


def quantize(mean: np.ndarray, land: np.ndarray, scale: int) -> np.ndarray:
    """Scale, round, and stamp NODATA everywhere that is not land."""
    q = np.rint(mean * scale)
    q = np.clip(q, -32767, 32767)  # leave -32768 free as the sentinel
    return np.where(land, q, NODATA).astype("<i2")


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main() -> int:
    nx = int(round(360 / OUT_DEG))
    ny = int(round(180 / OUT_DEG))

    print("Fetching sources (cached in %s)" % CACHE)
    z_tavg = fetch(f"wc2.1_{CLIMATE_RES}_tavg")
    z_prec = fetch(f"wc2.1_{CLIMATE_RES}_prec")
    z_elev = fetch(f"wc2.1_{ELEV_RES}_elev")

    # ---- elevation, at the finer resolution -----------------------------
    print(f"Reading elevation ({ELEV_RES})")
    elev, elev_nd = read_tif(z_elev, f"wc2.1_{ELEV_RES}_elev.tif")
    k_elev = elev.shape[1] // nx
    if elev.shape != (ny * k_elev, nx * k_elev):
        print(f"  ! unexpected elevation shape {elev.shape}", file=sys.stderr)
        return 1
    elev_valid = elev != elev_nd
    print(f"  {elev.shape[1]}x{elev.shape[0]} -> {k_elev}x{k_elev} blocks")

    elev_mean, elev_count = block_mean(elev, elev_valid, k_elev)
    elev_rng = block_range(elev, elev_valid, k_elev)

    # A coarse cell is land if ANY fine cell in it is land. Being generous here
    # matters: it keeps small islands and thin coastlines clickable, which is
    # exactly where students go looking.
    land = elev_count > 0
    print(f"  land cells: {land.sum()} of {ny * nx} ({100 * land.sum() / (ny * nx):.1f}%)")

    # ---- climate, at 10m ------------------------------------------------
    planes: list[np.ndarray] = [quantize(elev_mean, land, SCALE_ELEV)]

    for var, zpath, scale in (("tavg", z_tavg, SCALE_TEMP), ("prec", z_prec, SCALE_PREC)):
        print(f"Reading {var} ({CLIMATE_RES})")
        for m in range(1, 13):
            a, nd = read_tif(zpath, f"wc2.1_{CLIMATE_RES}_{var}_{m:02d}.tif")
            k = a.shape[1] // nx
            # float32 nodata is a huge negative sentinel, so compare loosely
            valid = np.isfinite(a) & (a > -1e30) if a.dtype.kind == "f" else (a != nd)
            mean, _ = block_mean(a, valid, k)
            planes.append(quantize(mean, land, scale))
            print(f"  {var}_{m:02d} ", end="", flush=True)
        print()

    planes.append(quantize(elev_rng, land, SCALE_ELEV))

    if len(planes) != 26:
        print(f"  ! expected 26 planes, built {len(planes)}", file=sys.stderr)
        return 1

    # ---- write ----------------------------------------------------------
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw = np.stack(planes).astype("<i2").tobytes()

    bin_path = OUT_DIR / "world-30min.bin.gz"
    with gzip.open(bin_path, "wb", compresslevel=9) as f:
        f.write(raw)

    manifest = {
        "_comment": (
            "Generated by tools/build_climate_grid.py -- do not hand-edit. "
            "The client reads every grid constant from this file."
        ),
        "generated": date.today().isoformat(),
        "dataset": DATASET,
        "grid": {
            "nx": nx,
            "ny": ny,
            "res_deg": OUT_DEG,
            "lon_min": -180.0,
            "lat_max": 90.0,
            "row_order": "north-to-south",
            "nodata": NODATA,
        },
        "file": {
            "path": "world-30min.bin.gz",
            "dtype": "int16",
            "endian": "little",
            "layout": "band-sequential",
            "planes": len(planes),
            "bytes_raw": len(raw),
        },
        "planes": {
            "elev": {"index": 0, "units": "m", "scale": SCALE_ELEV},
            "tavg": {"index": 1, "count": 12, "units": "degC", "scale": SCALE_TEMP},
            "prec": {"index": 13, "count": 12, "units": "mm", "scale": SCALE_PREC},
            "elev_range": {
                "index": 25,
                "units": "m",
                "scale": SCALE_ELEV,
                "note": (
                    f"max-min elevation within each cell, measured at {ELEV_RES} "
                    "({k}x{k} samples). Understates true relief, because even that "
                    "is itself a cell average.".format(k=k_elev)
                ),
            },
        },
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    gz = bin_path.stat().st_size
    print()
    print(f"  raw        {len(raw) / 1e6:8.2f} MB")
    print(f"  gzipped    {gz / 1e6:8.2f} MB   ({len(raw) / gz:.1f}x)")
    print(f"  -> {bin_path.relative_to(REPO)}")
    print(f"  -> {(OUT_DIR / 'manifest.json').relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
