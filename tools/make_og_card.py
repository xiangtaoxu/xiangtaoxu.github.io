"""Link-preview ("Open Graph") card for the whole site.

1200x630 -- the size every platform crops from -- wired up as `website: image:`
in _quarto.yml. This is the thumbnail Slack, LinkedIn, X, Bluesky, iMessage and
mail clients show when someone pastes a link to the site.

The composition is the site's own: the canopy photo from the navbar behind an
opaque white card, the way every page puts white content over that banner. The
card has to be OPAQUE. A translucent one lets the canopy through and the panel
reads as mottled rather than clean, and the lockup's green (#3E6D4B) has nothing
like enough contrast to sit on the photo directly.

JPEG, not PNG: it is mostly a photograph, so JPEG is ~150 KB against ~510 KB for
the same picture as a PNG, and some scrapers give up on slow fetches.

    python tools/make_og_card.py        # needs pillow + cairosvg
"""

import os

import cairosvg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

W, H = 1200, 630            # the Open Graph standard; anything else gets cropped
MARGIN = 64                 # white card inset -- enough canopy left to frame it
LOGO_W = 660
CAPTION = "Xiangtao Xu Lab  ·  Cornell EEB"
CAPTION_PX, GAP = 31, 26

BANNER = os.path.join(ROOT, "images/banners/header-banner.jpg")
LOGO = os.path.join(ROOT, "images/logo/biom2-horizontal.svg")
OUT = os.path.join(ROOT, "images/og/biom2-card.jpg")

# Inter is the site font but is not installed locally; Lato is the closest
# humanist sans that ships with most distros, and this is one small line.
FONT = "/usr/share/fonts/truetype/lato/Lato-Regular.ttf"


def canopy():
    """The navbar banner, cover-cropped to the card and dimmed a little."""
    im = Image.open(BANNER).convert("RGB")
    s = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2
    im = im.crop((x, y, x + W, y + H))
    # The photo is bright enough that a white card on top of it barely reads;
    # knocking it back 14% gives the card an edge without looking dark.
    return ImageEnhance.Brightness(im).enhance(0.86)


def main():
    bg = canopy()

    # Drop shadow on its own mask layer, so it is a soft edge rather than the
    # hard offset rectangle you get from drawing a second rounded rect.
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle(
        [MARGIN - 2, MARGIN + 4, W - MARGIN + 2, H - MARGIN + 10], 30, fill=120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    out = Image.composite(Image.new("RGB", (W, H), (24, 34, 26)), bg, shadow)

    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle(
        [MARGIN, MARGIN, W - MARGIN, H - MARGIN], 30, fill=(255, 255, 255, 255))
    out = Image.alpha_composite(out.convert("RGBA"), card).convert("RGB")

    # Render the lockup at 2x and downsample -- cairosvg's own antialiasing at
    # the final size leaves the tree's thin circuit traces ragged.
    png = os.path.join(ROOT, "images/og/.logo-tmp.png")
    cairosvg.svg2png(url=LOGO, write_to=png, output_width=LOGO_W * 2,
                     background_color=None)
    logo = Image.open(png).convert("RGBA")
    logo = logo.resize((LOGO_W, round(LOGO_W * 208 / 565.84)), Image.LANCZOS)
    os.remove(png)

    # Centre logo + caption as ONE group, then nudge down: geometric centring
    # leaves a caption-sized hole under the text and looks top-heavy.
    block = logo.height + GAP + CAPTION_PX
    top = MARGIN + ((H - 2 * MARGIN) - block) // 2 + 10
    out.paste(logo, ((W - LOGO_W) // 2, top), logo)
    ImageDraw.Draw(out).text(
        (W // 2, top + logo.height + GAP), CAPTION, fill=(92, 92, 98),
        font=ImageFont.truetype(FONT, CAPTION_PX), anchor="ma")

    out.save(OUT, quality=90, subsampling=0, optimize=True)
    print(f"{OUT}  {W}x{H}  {os.path.getsize(OUT) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
