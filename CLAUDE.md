# CLAUDE.md

Guidance for working in this repository. Read this before making changes.

## What this is

The **BioM2 Lab** website (Xiangtao Xu Lab, Cornell EEB) — a static site built
with [Quarto](https://quarto.org) and served via GitHub Pages.

- **Repo:** `xiangtaoxu/xiangtaoxu.github.io`
- **Live at:** <https://xiangtaoxu.eeb.cornell.edu> (custom domain, see `CNAME`)
- **Content is prose, not code.** Most pages are Markdown (`.qmd`) with YAML
  front matter. There is no application, no database, no build step beyond
  `quarto render`.

## Core design principles

1. **Content in `.qmd`, presentation in `theme.scss`, structure in `_quarto.yml`.**
   Keep these concerns separate. A new page adds a `.qmd`; a visual tweak edits
   `theme.scss`; a navbar/footer/theme change edits `_quarto.yml`. Avoid inline
   `<style>` or per-page CSS — centralize styling in `theme.scss`.

2. **Data-driven pages via Quarto _listings_.** Repeated content (team members,
   news posts) is never hand-maintained as a list. Each item is its own `.qmd`
   file in a folder, and a `listing:` block in the parent page auto-scans the
   folder and renders cards/tables. To add an item, add a file; to reorder, set
   a sort field. See `team.qmd`, `news.qmd`, and `index.qmd`.

3. **Grouping by folder, ordering by front-matter field.** Current vs. alumni
   members are separated by *folder* (`members/current/` vs `members/alumni/`),
   so the two listings can never overlap. Order within a listing comes from a
   front-matter field the listing sorts on (`weight` for members, `date` for
   news, `sort_key` for alumni). Retiring a member = move the file between
   folders; no other edits.

4. **The single source of truth for site-wide layout is `theme.scss`.** Because
   Quarto appends its own structural CSS *after* the theme, some overrides there
   need higher specificity or `!important` (e.g. the wide-screen content-column
   width). Existing overrides are commented with *why* — preserve those comments
   and follow the same pattern rather than fighting the cascade elsewhere.

5. **Comment the intent, not the syntax.** Existing files explain *why* a choice
   was made (e.g. why a listing splits by folder, why `max-height` was removed
   from the hero). Match that voice: brief comments that a future editor —
   possibly non-technical — can act on.

## Conventions

- **Styling:** Cornell carnelian (`$primary: #b31b1b`) is the accent color;
  "Inter" is the site font (loaded from Google Fonts in `_quarto.yml`, with a
  system-font fallback). Base theme is Bootswatch **litera**, layered with
  `theme.scss` (order matters — `theme.scss` wins).
- **Member files** (`members/current/*.qmd`, `members/alumni/*.qmd`): use the
  `about:` front matter for the profile page; `image:`, `subtitle`, `weight`
  feed the team-page card. Alumni also need `sort_key` and a one-line `details`.
- **News posts** (`news/*.qmd`): filename is `YYYY-MM-DD-slug.qmd`; front matter
  needs `title`, `date`, `description`, optional `image` (path under
  `images/news/`), and `categories`. Posts with no `image` render text-only.
- **Bold names** in publication lists (`research.qmd`) mark lab members at time
  of publication — keep that convention when adding papers.
- **Images** live under `images/` by kind: `portraits/`, `news/`, `banners/`,
  `hero/`, `projects/`. Reference them with site-absolute paths (`/images/...`).
- Any asset referenced *only* from `theme.scss` (banner, hero GIF) must also be
  listed under `project.resources` in `_quarto.yml`, or Quarto won't copy it
  into the build.

## Build & preview

Quarto here runs from a **conda env named `website`** (it carries pinned
`quarto`, `deno`, `dart-sass`, `pandoc`, etc.). `quarto` is *not* on the bare
`PATH` — activate the env first, or renders fail with missing-`deno`/`sass`
errors:

```bash
conda activate website
quarto preview     # live-reloading local preview
quarto render      # build the static site into _site/ (git-ignored)
```

The CI pin is Quarto **1.9.38** — keep local and CI in sync when upgrading.

## Deploying

The live site is served from the **`gh-pages`** branch. Do **not** hand-edit or
commit `_site/` (it's git-ignored). Two paths publish it:

- **Automatic (preferred):** pushing to **`main`** triggers
  `.github/workflows/publish.yml`, which renders and pushes to `gh-pages`.
- **Manual:** `quarto publish gh-pages --no-prompt`.

`CNAME` is listed under `project.resources` so it survives every publish —
removing it breaks the custom domain.

> Note: the primary branch on GitHub is `main` (what CI deploys from). A local
> clone may be on a differently named branch — push to `main` to deploy.

## Guardrails

- Never commit `_site/` or `.quarto/` (already git-ignored).
- Don't remove `CNAME` or its `project.resources` entry.
- Prefer editing `theme.scss` over adding page-level styles.
- When adding repeated content, add a file to the relevant listing folder rather
  than editing a hand-written list.
