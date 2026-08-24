--[[
  news-image.lua — show a news post's front-matter `image:` in the post itself.

  A post's `image:` is what the listings (home page, News page) use as the
  thumbnail; without this filter it never appears on the post page you land on
  after clicking through. Rather than pasting the same picture into every post
  body by hand (and having to keep the two in sync), we insert it here, once,
  at the top of the body.

  Applied only to news posts, via `news/_metadata.yml`. Posts with no `image:`
  are left untouched. Alt text comes from `image-alt:` if a post sets one,
  otherwise the post title.
--]]

function Pandoc(doc)
  local image = doc.meta.image
  if image == nil then return doc end

  local src = pandoc.utils.stringify(image)
  if src == "" then return doc end

  local alt = doc.meta["image-alt"] or doc.meta.title
  alt = alt and pandoc.utils.stringify(alt) or ""

  -- Empty caption on purpose: the picture illustrates the story, it isn't a
  -- numbered figure. `fig-alt` still gives it an alt attribute for screen readers.
  local fig = pandoc.Image({}, src, "", pandoc.Attr("", { "news-hero" }, { ["fig-alt"] = alt }))
  table.insert(doc.blocks, 1, pandoc.Para({ fig }))
  return doc
end
