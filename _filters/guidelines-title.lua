--[[
  guidelines-title.lua — drop the guidelines' repeated title block on the web.

  _guidelines/lab-guidelines-vX.Y.md carries its title, version and byline TWICE:
  once in the YAML front matter and again as an H1 block at the top of the body,
  closed by a horizontal rule. The duplicate is deliberate — the file is read
  directly on GitHub, where front matter renders as a metadata table rather than
  as a heading, so without the body block the document would open untitled.

  On the website that same block collides with Quarto's own title block, which is
  built from the front matter: the page opens with two H1s saying the same thing,
  and the byline's "Website" link points back at the page you are already on.
  So strip it here and let the standard title block stand alone, exactly as
  tools/build_guidelines_pdf.py strips it before handing the body to Typst.

  The version line is the exception: it is the one thing in that block the page
  cannot get from anywhere else, and a guidelines document that does not say which
  version you are reading is worth less. So the block's paragraph is truncated at
  its first line break -- keeping "**Version 3.3 — September 2026**" and dropping
  the department line (already the subtitle) and the byline links (one of which
  points at this very site).

  Applied only to lab-guidelines.qmd, via that file's `filters:` key. A file with
  no such block is left untouched.
--]]

function Pandoc(doc)
  local start
  for i, block in ipairs(doc.blocks) do
    if block.t == "Header" and block.level == 1 then
      start = i
      break
    end
    -- Only a leading block counts. Anything substantive before the H1 means the
    -- document is not shaped the way we think, so leave it alone.
    if block.t ~= "HorizontalRule" then return doc end
  end
  if start == nil then return doc end

  local stop
  for i = start + 1, #doc.blocks do
    if doc.blocks[i].t == "HorizontalRule" then
      stop = i
      break
    end
  end
  if stop == nil then return doc end

  -- Salvage the version line before deleting the block: it is the first line of
  -- the paragraph under the heading, up to the break that ends it.
  local version
  for i = start + 1, stop - 1 do
    local block = doc.blocks[i]
    if block.t == "Para" then
      local kept = {}
      for _, inline in ipairs(block.content) do
        if inline.t == "SoftBreak" or inline.t == "LineBreak" then break end
        table.insert(kept, inline)
      end
      if #kept > 0 then version = pandoc.Para(kept) end
      break
    end
  end

  for _ = start, stop do
    table.remove(doc.blocks, start)
  end
  if version then table.insert(doc.blocks, start, version) end
  return doc
end
