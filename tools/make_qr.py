#!/usr/bin/env python3
"""Generate a STATIC QR code for the site, as SVG (print) and PNG (slides).

Static is the whole point. Most free QR generators hand you a *dynamic* code: the
bitmap encodes their domain and redirects to yours, which buries a permanent
third-party dependency inside a printed object. When that service expires, caps scans
or goes paid, every poster already on a wall stops working. A static code encodes the
URL itself -- no account, no provider, nothing to renew, and the only thing it depends
on is the URL continuing to resolve.

So this is not a wrapper around a service. It is a few lines over `segno`, kept in the
repo so the code is reproducible in three years instead of being a file you have to
find again.

Output goes to `qr/`, which is git-ignored: the generated images are derived artefacts,
regenerate in a second, and don't belong in version history.

Which URL to encode is the real long-term decision, not the generator:

  xiangtaoxu.eeb.cornell.edu   reads better on a poster, but it is Cornell EEB's DNS
                               zone -- if you move institutions, printed codes die.
  xiangtaoxu.github.io         tied to the GitHub account, so it survives a move. It
                               currently 301s to the custom domain; if that hostname
                               ever went away, deleting CNAME makes github.io serve
                               directly.

For something printed to last, prefer --github. For a conference poster this season,
the default custom domain looks better.

Usage
-----
    pip install segno            # pure Python, no system libraries

    python tools/make_qr.py                          # the site, EC level M
    python tools/make_qr.py --github                 # the durable github.io target
    python tools/make_qr.py --ec q                   # tolerates scuffing / a logo
    python tools/make_qr.py --upper                  # smaller symbol, see below
    python tools/make_qr.py --src poster-esa2026     # tag scans in GoatCounter
    python tools/make_qr.py --url https://example.org/x --name whatever

`--upper` uppercases the URL, which switches the encoder from byte mode into QR's
alphanumeric mode and typically drops one version (29x29 -> 25x25 for this domain),
making the modules ~16% larger at the same printed size and easier to scan from a
distance. Safe because URL schemes and DNS hostnames are both case-insensitive -- so
it is REFUSED for any URL carrying a path or query, which on GitHub Pages are not.

Whatever this prints, scan the result with a phone once before sending it to a printer.
That takes five seconds and is the only check that fully counts.
"""

import argparse
import pathlib
import sys
import tempfile
import urllib.parse

SITE_CUSTOM = "https://xiangtaoxu.eeb.cornell.edu"
SITE_GITHUB = "https://xiangtaoxu.github.io"

# Rule of thumb for printed QR codes: usable width is about a tenth of the distance
# you want to scan from. Below ~0.4 mm per module, phone cameras start to struggle.
MIN_MODULE_MM = 0.4
SCAN_DISTANCES_M = (0.3, 1.5, 3.0)  # handheld, poster, projected


def build_url(args):
    url = args.url or (SITE_GITHUB if args.github else SITE_CUSTOM)
    if args.src:
        parts = urllib.parse.urlparse(url)
        # A bare host with a query ("host?x=1") is legal but odd; keep the canonical
        # "host/?x=1" so the printed URL matches what a browser would show.
        if not parts.path:
            url += "/"
        sep = "&" if parts.query else "?"
        url = f"{url}{sep}src={urllib.parse.quote(args.src)}"
    if args.upper:
        parts = urllib.parse.urlparse(url)
        if parts.path not in ("", "/") or parts.query or parts.fragment:
            sys.exit(
                "--upper only works for a bare scheme+host.\n"
                f"  {url}\n"
                "carries a path/query, and those are case-sensitive on GitHub Pages, "
                "so uppercasing would produce a code that resolves to a 404."
            )
        url = url.upper()
    return url


def report_sizes(modules_with_border):
    print("  print size (rule of thumb: width = scan distance / 10)")
    for d in SCAN_DISTANCES_M:
        width_mm = d * 1000 / 10
        module_mm = width_mm / modules_with_border
        flag = "" if module_mm >= MIN_MODULE_MM else "  <-- too small, print bigger"
        print(f"    scan from {d:>4.1f} m  ->  {width_mm:>5.0f} mm wide "
              f"({module_mm:.2f} mm/module){flag}")


def verify(qr, expected):
    """Prove the SYMBOL encodes the intended URL.

    Deliberately decoded from a temporary render, not from the output PNG. What needs
    checking is the encoded content, which is scale-invariant -- whereas OpenCV's
    detector fails at some specific pixel sizes on codes that are perfectly valid
    (a 41-module symbol at scale 39 reads as empty, while 4, 8, 10, 20 and 50 all
    decode fine). Validating the output file's dimensions would raise false alarms
    about good codes, which is worse than not checking at all.

    Several scales are tried so one such quirk can't produce a spurious failure.
    """
    try:
        import cv2
    except ImportError:
        print("  NOT VERIFIED: opencv (cv2) unavailable -- scan it with a phone.")
        return True

    det = cv2.QRCodeDetector()
    with tempfile.TemporaryDirectory() as tmp:
        for scale in (10, 8, 16, 25):
            probe = pathlib.Path(tmp) / f"probe{scale}.png"
            qr.save(probe, scale=scale, border=4, dark="black", light="white")
            text, _, _ = det.detectAndDecode(cv2.imread(str(probe)))
            if text == expected:
                print(f"  verified: symbol decodes to {text}")
                return True
            if text:
                print(f"  DECODE MISMATCH: got {text!r}, expected {expected!r}",
                      file=sys.stderr)
                return False
    print("  NOT VERIFIED: no probe render decoded; scan it with a phone before use.",
          file=sys.stderr)
    return False


def main():
    p = argparse.ArgumentParser(
        description="Generate a static QR code for the site (SVG + PNG).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Output in qr/ is git-ignored; regenerate rather than commit.",
    )
    src = p.add_mutually_exclusive_group()
    src.add_argument("--github", action="store_true",
                     help=f"encode {SITE_GITHUB} (survives a change of institution)")
    src.add_argument("--url", help="encode an arbitrary URL instead")
    p.add_argument("--src", help="append ?src=TAG so scans are separable in GoatCounter")
    p.add_argument("--upper", action="store_true",
                   help="uppercase a bare domain for a smaller symbol (see docstring)")
    p.add_argument("--ec", choices=("l", "m", "q", "h"), default="m",
                   help="error correction: more is denser but survives damage "
                        "(default: %(default)s)")
    p.add_argument("--name", help="output basename (default: derived from the host)")
    p.add_argument("--out", default="qr", help="output dir (default: %(default)s)")
    p.add_argument("--png-px", type=int, default=1600,
                   help="approximate PNG width in pixels (default: %(default)s)")
    args = p.parse_args()

    try:
        import segno
    except ImportError:
        sys.exit("segno is not installed. Run:  pip install segno")

    url = build_url(args)
    name = args.name or urllib.parse.urlparse(url.lower()).netloc.split(".")[0] or "qr"
    if args.src:
        name = f"{name}-{args.src}"
    if args.ec != "m":
        name = f"{name}-ec{args.ec.upper()}"
    if args.upper:
        name = f"{name}-upper"

    qr = segno.make(url, error=args.ec, micro=False)
    out_dir = pathlib.Path(__file__).resolve().parent.parent / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    # border=4 is the mandatory quiet zone. Plenty of web generators crop it and
    # produce codes that scan unreliably; don't.
    svg = out_dir / f"{name}.svg"
    png = out_dir / f"{name}.png"
    qr.save(svg, scale=10, border=4, dark="black", light="white")
    size = qr.symbol_size(border=4)[0]
    qr.save(png, scale=max(1, round(args.png_px / size)), border=4,
            dark="black", light="white")

    print(f"encoded: {url}")
    print(f"  version {qr.version}, {qr.mode} mode, "
          f"{size}x{size} modules incl. quiet zone, EC {args.ec.upper()}")
    print(f"  {svg}   <-- use this for anything printed")
    print(f"  {png}")
    report_sizes(size)
    ok = verify(qr, url)
    print("Dark-on-light only: inverted codes fail on many scanners, so don't set it "
          "on a coloured background.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
