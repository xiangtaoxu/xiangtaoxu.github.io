# Saved citations (reserved for the future Publications page)

`sources.yaml` is the curated list of publication DOIs copied verbatim from the
old Jekyll site (`xiangtaoxu.github.io/_data/sources.yaml`). Each entry carries a
DOI plus optional `members`, `tags`, `image`, and `date` annotations.

Nothing here is rendered yet — this folder starts with `_`, so Quarto ignores it.
It is parked here so the hand-curated DOI list is not lost when we build the
Publications page later.

**Planned use:** a small script will expand each DOI into full citation metadata
(via Manubot / Crossref / ORCID / OpenAlex) and emit either a `references.bib`
(for a formatted reference list) or a `pubs.yml` (for a filterable card listing),
which a new `publications.qmd` will render. See the migration plan for details.
