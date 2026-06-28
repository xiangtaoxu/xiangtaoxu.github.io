# labwebsite_quarto

BioM2 Lab website, built with [Quarto](https://quarto.org). Currently scaffolded
with a **Home** page and a **Team** page (current members + alumni).

## Quick start

```bash
# 1. Install Quarto (one-time)  -> see https://quarto.org/docs/get-started/
# 2. Live preview (opens in your browser, auto-reloads as you edit):
quarto preview

# 3. Build the static site into _site/ (what you deploy):
quarto render
```

## Structure

| Path                       | What it is                                            |
|----------------------------|-------------------------------------------------------|
| `_quarto.yml`              | Site-wide config: navbar, theme, footer               |
| `theme.scss`               | Colors and styling (Cornell carnelian)                |
| `index.qmd`                | Home page                                             |
| `team.qmd`                 | Team page (two listings: current + alumni)            |
| `members/*.qmd`            | One file per person — also their own profile page     |
| `images/portraits/`        | Member photos (`placeholder.svg` until you add real)  |
| `_citations/`              | Saved DOIs for the future Publications page (ignored)  |
| `_site/`                   | Generated output (git-ignored)                        |

## Add a team member

1. Copy an existing file in `members/current/` (e.g. `jane-doe.qmd`).
2. Edit `title`, `subtitle`, `role`, `weight`, `links`, and the bio.
3. Drop a photo in `images/portraits/` and point `image:` at it.

Members are grouped **by folder**:

- `members/current/` → shown under **Current members**
- `members/alumni/`  → shown under **Alumni**

To retire someone, move their `.qmd` file from `members/current/` to `members/alumni/`.
