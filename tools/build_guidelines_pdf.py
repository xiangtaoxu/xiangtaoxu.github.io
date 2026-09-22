#!/usr/bin/env python3
"""Render the lab guidelines Markdown to a print-ready PDF.

    conda activate website          # pandoc + typst live in this env
    python tools/build_guidelines_pdf.py

Pandoc converts the Markdown to Typst and Typst sets the pages. Typst rather
than LaTeX because the system TeX here is a minimal install with no fontspec,
xcolor or titlesec, and typst ships everything it needs.

The page design lives in tools/guidelines.typ. This script only reshapes the
Markdown for print: the source repeats its title, version and byline in the body
so that it reads well on GitHub, and that block would collide with the PDF's
title page, so it is lifted into metadata instead.
"""

import argparse
import datetime
import io
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Underscore-prefixed, so Quarto never renders the superseded drafts as pages.
# lab-guidelines.qmd includes the current one; this script sets the same file.
SOURCES = ROOT / "_guidelines"
TEMPLATE = ROOT / "tools" / "guidelines.typ"

WEBSITE = "https://xiangtaoxu.eeb.cornell.edu/"
GITHUB = "https://github.com/BioM2-Lab"


def newest_source():
    """The highest-numbered lab-guidelines-vX.Y.md in _guidelines/."""
    def version(p):
        m = re.search(r"-v(\d+)\.(\d+)\.md$", p.name)
        return (int(m.group(1)), int(m.group(2))) if m else (-1, -1)

    found = sorted(SOURCES.glob("lab-guidelines-v*.md"), key=version)
    if not found:
        sys.exit("no lab-guidelines-v*.md found in %s" % SOURCES)
    return found[-1]


def prepare(src):
    """Split the source into print metadata plus a body with no title block."""
    lines = io.open(src, encoding="utf-8").read().split("\n")
    if lines[0].strip() != "---":
        sys.exit("%s: expected YAML front matter" % src.name)
    close = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")

    meta = {}
    for line in lines[1:close]:
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip().strip('"')
    body = lines[close + 1:]

    # Drop the body's own title block: the H1 down to the rule that closes it.
    h1 = next(i for i, l in enumerate(body) if l.startswith("# "))
    rule = next(i for i in range(h1, len(body)) if body[i].strip() == "---")
    body = body[:h1] + body[rule + 1:]

    # Drop the remaining thematic breaks. On GitHub they separate the numbered
    # sections; in print the section headings already do that.
    body = [l for l in body if l.strip() != "---"]

    # Lift the opening paragraph out so the contents list can follow it.
    while body and not body[0].strip():
        body.pop(0)
    lead = []
    while body and body[0].strip():
        lead.append(body.pop(0))

    # The closing italic colophon repeats what the page footer already says.
    while body and not body[-1].strip():
        body.pop()
    if body and body[-1].startswith("*BioM2 Lab"):
        body.pop()

    kept, blanks = [], 0
    for line in body:
        if not line.strip():
            blanks += 1
            if blanks > 1:
                continue
        else:
            blanks = 0
        kept.append(line)

    date = datetime.date.fromisoformat(meta["date"])
    front = [
        "---",
        'title: "%s"' % meta["title"],
        'subtitle: "%s"' % meta["subtitle"],
        'version: "%s"' % meta["version"],
        'datelong: "%s"' % date.strftime("%B %-d, %Y"),
        'website: "%s"' % WEBSITE,
        'github: "%s"' % GITHUB,
        "lead: |",
    ] + ["  " + l for l in lead] + ["---", ""]

    return "\n".join(front + kept).strip() + "\n", meta["version"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", nargs="?", type=pathlib.Path,
                    help="guidelines Markdown (default: the newest at the repo root)")
    ap.add_argument("-o", "--output", type=pathlib.Path,
                    help="output PDF (default: alongside the source)")
    args = ap.parse_args()

    if not shutil.which("pandoc") or not shutil.which("typst"):
        sys.exit("pandoc and typst must be on PATH — run `conda activate website` first")

    src = args.source or newest_source()
    prepped, version = prepare(src)
    out = args.output or src.with_suffix(".pdf")

    with tempfile.TemporaryDirectory() as tmp:
        staged = pathlib.Path(tmp) / "body.md"
        io.open(staged, "w", encoding="utf-8").write(prepped)
        subprocess.run([
            "pandoc", str(staged),
            "--from", "markdown",
            "--to", "typst",
            "--template", str(TEMPLATE),
            # The body's H1 was removed, so promote the numbered sections to
            # level 1; the contents list then nests correctly.
            "--shift-heading-level-by=-1",
            "--toc", "--toc-depth=2",
            "--pdf-engine", "typst",
            "--output", str(out),
        ], check=True)

    print("%s -> %s (v%s)" % (src.name, out.name, version))


if __name__ == "__main__":
    main()
