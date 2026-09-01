#!/usr/bin/env python3
"""Pull visitor counts from goatcounter.com into local CSVs.

The counts live on someone else's server (Hetzner, Finland/Germany, operated by one
person on donations). That is fine, but it means **their copy is the only copy**. This
script makes a local one, so a lapsed service, a deleted account or a changed retention
setting can't take the record with it. Run it at the end of each term.

Two files are written, both regenerated from scratch every run (so re-running is safe
and idempotent):

  visitors-by-path.csv   One row per page: cumulative visitor count for the range.
                         This is the headline number -- each Teaching tool page's row
                         is that activity card's count.
  visitors-daily.csv     Long format (day, path, visitors). The full history, so you
                         can plot a term or diff two runs.

Output is written to `analytics/` which is **git-ignored on purpose**: this repository
is public, and publishing the numbers is exactly what we don't want. Keep it that way.
If you ever do want a number in public, copy the single figure out by hand.

A note on what "visitors" means, because the CSV header can't carry a caveat:
GoatCounter stores visitors, not raw pageviews -- deduplicated per IP + browser over an
8-hour window. Two students behind one campus NAT on the same browser build can collapse
into one visitor, so treat every number here as a LOWER BOUND. Ad-blockers cut it further.

Usage
-----
    # One-time: make a token at https://xiangtaoxu.goatcounter.com/user/api
    # with the "Read statistics" permission, then:
    export GOATCOUNTER_API_TOKEN=...

    python tools/sync_visitor_stats.py --check      # verify the token, write nothing
    python tools/sync_visitor_stats.py              # sync everything, all time
    python tools/sync_visitor_stats.py --start 2026-09-01 --end 2026-12-31

The token is read from $GOATCOUNTER_API_TOKEN, or from a file named by
--token-file (default ~/.config/goatcounter/token). It is deliberately NOT accepted as
a command-line argument, where it would land in shell history and `ps` output.

Requires nothing outside the Python standard library.
"""

import argparse
import csv
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Well before the site existed, so the default range means "everything". The API
# otherwise defaults to the last 7 days, which would silently truncate the history.
EPOCH = "2000-01-01"

# The API caps `limit` at 100 paths per response. The site has ~9, so this never
# paginates in practice; if it ever does, the script says so rather than truncating
# quietly (see fetch_hits).
MAX_LIMIT = 100

RATE_LIMIT_PAUSE = 0.3  # API allows 4 req/s; we make a handful of calls.


def read_token(token_file):
    """Token from the environment, else from a file. Never from argv."""
    token = os.environ.get("GOATCOUNTER_API_TOKEN", "").strip()
    if token:
        return token
    path = pathlib.Path(token_file).expanduser()
    if path.is_file():
        token = path.read_text(encoding="utf-8").strip()
        if token:
            return token
    sys.exit(
        f"No API token. Set GOATCOUNTER_API_TOKEN, or put the token in {path}.\n"
        f"Create one at https://<site>.goatcounter.com/user/api with 'Read statistics'."
    )


def api_get(base, token, endpoint, params=None):
    url = f"{base}/api/v0/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "biom2-sync-visitor-stats/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")[:400]
        if err.code == 401:
            sys.exit("401 Unauthorized -- the token is missing or wrong.")
        if err.code == 403:
            sys.exit("403 Forbidden -- the token lacks the 'Read statistics' permission.")
        if err.code == 429:
            sys.exit("429 Rate limited -- wait a minute and re-run.")
        sys.exit(f"HTTP {err.code} from {endpoint}: {body}")
    except urllib.error.URLError as err:
        sys.exit(f"Could not reach {base}: {err.reason}")


def fetch_hits(base, token, start, end, limit):
    """Per-path visitor counts with their daily breakdown."""
    data = api_get(base, token, "stats/hits", {
        "start": start, "end": end, "limit": limit, "group": "daily",
    })
    hits = data.get("hits", [])
    if data.get("more"):
        # Not silently truncating: the API pages via exclude_paths, which this script
        # doesn't implement because the site has nowhere near 100 paths.
        print(
            f"WARNING: more than {limit} paths exist; this file is INCOMPLETE. "
            f"Narrow --start/--end, or extend the script to page via exclude_paths.",
            file=sys.stderr,
        )
    return hits, data.get("total", 0)


def write_by_path(out_dir, hits):
    path = out_dir / "visitors-by-path.csv"
    rows = sorted(hits, key=lambda h: (-h.get("count", 0), h.get("path", "")))
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["path", "title", "is_event", "visitors"])
        for h in rows:
            w.writerow([
                h.get("path", ""),
                h.get("title", ""),
                "yes" if h.get("event") else "no",
                h.get("count", 0),
            ])
    return path, len(rows)


def write_daily(out_dir, hits):
    path = out_dir / "visitors-daily.csv"
    rows = []
    for h in hits:
        for stat in h.get("stats") or []:
            # Skip empty days so the file stays a record of activity, not of calendar.
            if stat.get("daily", 0):
                rows.append((stat["day"], h.get("path", ""),
                             "yes" if h.get("event") else "no", stat["daily"]))
    rows.sort()
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["day", "path", "is_event", "visitors"])
        w.writerows(rows)
    return path, len(rows)


def main():
    p = argparse.ArgumentParser(
        description="Sync GoatCounter visitor counts to local CSVs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Output is git-ignored: this repo is public and the numbers are private.",
    )
    p.add_argument("--site", default="xiangtaoxu",
                   help="GoatCounter site code (default: %(default)s)")
    p.add_argument("--start", default=EPOCH,
                   help="Start date YYYY-MM-DD (default: %(default)s, i.e. everything)")
    p.add_argument("--end", default=None,
                   help="End date YYYY-MM-DD (default: today)")
    p.add_argument("--out", default="analytics",
                   help="Output directory, relative to repo root (default: %(default)s)")
    p.add_argument("--token-file", default="~/.config/goatcounter/token",
                   help="Fallback token file if $GOATCOUNTER_API_TOKEN is unset")
    p.add_argument("--limit", type=int, default=MAX_LIMIT,
                   help=f"Max paths to fetch, API caps at {MAX_LIMIT} (default: %(default)s)")
    p.add_argument("--check", action="store_true",
                   help="Verify the token and exit without writing anything")
    args = p.parse_args()

    base = f"https://{args.site}.goatcounter.com"
    token = read_token(args.token_file)
    end = args.end or time.strftime("%Y-%m-%d")

    me = api_get(base, token, "me")
    user = (me.get("user") or {}).get("email", "?")
    site = (me.get("site") or {}).get("code", args.site)
    print(f"Authenticated to {base} as {user} (site: {site})")
    if args.check:
        print("Token OK. Nothing written (--check).")
        return 0

    time.sleep(RATE_LIMIT_PAUSE)
    totals = api_get(base, token, "stats/total", {"start": args.start, "end": end})
    time.sleep(RATE_LIMIT_PAUSE)
    hits, _ = fetch_hits(base, token, args.start, end, min(args.limit, MAX_LIMIT))

    if not hits:
        print(f"No data in {args.start}..{end}. Nothing written.", file=sys.stderr)
        return 1

    out_dir = pathlib.Path(__file__).resolve().parent.parent / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    by_path, n_paths = write_by_path(out_dir, hits)
    daily, n_days = write_daily(out_dir, hits)

    print(f"Range {args.start}..{end}")
    print(f"  {totals.get('total', 0):>7} visitors total "
          f"({totals.get('total_events', 0)} of them events)")
    print(f"  {by_path}  ({n_paths} paths)")
    print(f"  {daily}  ({n_days} path-days)")
    print("Counts are visitors (8h-deduplicated), not pageviews -- a lower bound.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
