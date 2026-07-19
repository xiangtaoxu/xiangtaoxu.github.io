# xiangtaoxu.github.io

BioM2 Lab website, built with [Quarto](https://quarto.org). Live at
**[xiangtaoxu.eeb.cornell.edu](https://xiangtaoxu.eeb.cornell.edu)**.

## Quick start

```bash
# 1. Install Quarto (one-time)  -> see https://quarto.org/docs/get-started/
# 2. Live preview (opens in your browser, auto-reloads as you edit):
quarto preview

# 3. Build the static site into _site/ (what you deploy):
quarto render
```

## Structure

| Path                       | What it is                                             |
|-----------------------------|--------------------------------------------------------|
| `_quarto.yml`               | Site-wide config: navbar, theme, footer                |
| `theme.scss`                | Colors and styling (Cornell carnelian)                 |
| `index.qmd`                 | Home page                                              |
| `team.qmd`                  | Team page (current members + a compact alumni list)    |
| `research.qmd`               | Research themes, projects, and Publications             |
| `codifi.qmd`                | Cornell Digital Forestry Initiative page                |
| `news.qmd` / `news/*.qmd`   | News listing + one file per post                        |
| `members/current/*.qmd`     | One file per current member — also their own profile page |
| `members/alumni/*.qmd`      | One file per alum (shown as a compact list, no photo)   |
| `images/`                   | Portraits, news photos, banners, hero animation         |
| `_citations/`               | Cached/curated publication data (DOIs, resolved metadata) |
| `CNAME`                     | Custom domain — required for every gh-pages publish     |
| `_site/`                    | Generated output (git-ignored)                          |

## Deploying updates

The live site is served from the `gh-pages` branch (custom domain configured in
this repo's GitHub Pages settings). To publish changes on `main`:

```bash
quarto publish gh-pages --no-prompt
```

This renders the site and pushes it to `gh-pages`. The `CNAME` file is listed
under `project.resources` in `_quarto.yml` so it's preserved on every publish —
don't remove it, or the custom domain will break.

## Add a team member

1. Copy an existing file in `members/current/` (e.g. `cam-reimer.qmd`).
2. Edit `title`, `subtitle`, `role`, `weight`, `links`, and the bio.
3. Drop a photo in `images/portraits/` and point `image:` at it.

Members are grouped **by folder**:

- `members/current/` → grid of cards under **Current members**
- `members/alumni/`  → compact text list under **Alumni** (add `sort_key` and
  `details` fields — see any existing alumni file for the format)

To retire someone, move their `.qmd` file from `members/current/` to `members/alumni/`.

To retire someone, move their `.qmd` file from `members/current/` to `members/alumni/`.
