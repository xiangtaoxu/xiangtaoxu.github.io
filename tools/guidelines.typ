// Pandoc → Typst template for the BioM2 Lab Guidelines.
// Palette and type follow the lab website (Cornell carnelian accent, Lato).

#let accent   = rgb("#b31b1b")
#let ink      = rgb("#1c1c1e")
#let muted    = rgb("#6a6f75")
#let hairline = rgb("#dcdee1")
#let wash     = rgb("#f6f3f3")

#let horizontalrule = align(center, line(length: 35%, stroke: 0.5pt + hairline))

#show terms: it => {
  it.children.map(child => [
    #strong[#child.term]
    #block(inset: (left: 1.5em, top: -0.4em))[#child.description]
  ]).join()
}

#set document(title: "$title$", author: "BioM2 Lab, Cornell University")

#set page(
  paper: "us-letter",
  margin: (top: 2.1cm, bottom: 2.0cm, left: 2.3cm, right: 2.3cm),
  footer: context {
    set text(size: 8pt, fill: muted)
    line(length: 100%, stroke: 0.5pt + hairline)
    v(3pt)
    grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      [$title$ · v$version$],
      counter(page).display("1"),
    )
  },
)

#set text(font: ("Lato", "DejaVu Sans"), size: 10.5pt, fill: ink, lang: "en")
#set par(justify: true, leading: 0.66em, spacing: 0.95em, first-line-indent: 0pt)

// Links keep the surrounding text colour and are marked by a carnelian rule.
// Colouring the words themselves turns the all-link resource lists (§4.1, §6.3)
// into a solid block of red, so the underline carries the signal instead.
#show link: it => underline(
  stroke: 0.6pt + accent,
  offset: 2.2pt,
  evade: true,
  it,
)

// Section headings: carnelian, with a hairline under them.
#show heading.where(level: 1): it => block(breakable: false, above: 1.7em, below: 0.85em)[
  #text(size: 15pt, weight: 700, fill: accent, it.body)
  #v(4pt)
  #line(length: 100%, stroke: 0.6pt + accent.lighten(55%))
]
#show heading.where(level: 2): it => block(breakable: false, above: 1.4em, below: 0.75em)[
  #text(size: 11.5pt, weight: 700, fill: ink, it.body)
]
#show heading.where(level: 3): it => block(above: 1.15em, below: 0.6em)[
  #text(size: 10.5pt, weight: 700, fill: muted, it.body)
]

#set list(marker: text(fill: accent, [•]), indent: 0.3em, spacing: 0.72em, body-indent: 0.55em)
#set enum(indent: 0.3em, spacing: 0.72em, body-indent: 0.5em)

// Callout: the internal-handbook note in §6.1.
#show quote.where(block: true): it => block(
  width: 100%,
  fill: wash,
  stroke: (left: 2pt + accent),
  inset: (x: 11pt, y: 9pt),
  radius: (right: 2pt),
)[#set text(size: 10pt); #it.body]

#set quote(quotes: false)

$for(header-includes)$
$header-includes$
$endfor$

// ---------------------------------------------------------------- title block
#block(above: 0pt, below: 0pt)[
  #text(size: 23pt, weight: 800, fill: ink)[$title$]
  #v(5pt)
  #text(size: 11.5pt, fill: muted)[$subtitle$]
  #v(9pt)
  #line(length: 100%, stroke: 2pt + accent)
  #v(6pt)
  #text(size: 9pt, fill: muted)[
    Version $version$ · $datelong$ · #link("$website$")[xiangtaoxu.eeb.cornell.edu] · #link("$github$")[github.com/BioM2-Lab]
  ]
]

#v(20pt)

$if(lead)$
#block(inset: (left: 0pt))[
  #set text(size: 11pt)
  $lead$
]
$endif$

#v(14pt)

#block(breakable: false)[
  #text(size: 12pt, weight: 700, fill: accent)[Contents]
  #v(6pt)
  #line(length: 100%, stroke: 0.6pt + accent.lighten(55%))
  #v(8pt)
  #show outline.entry.where(level: 1): it => {
    v(5pt, weak: true)
    text(weight: 700, fill: ink, it)
  }
  #show outline.entry.where(level: 2): it => text(size: 9.5pt, fill: muted, it)
  #outline(title: none, depth: 2, indent: 1.1em)
]

#pagebreak()

$body$

#v(18pt)
#line(length: 100%, stroke: 0.6pt + hairline)
#v(5pt)
#align(center)[
  #text(size: 8.5pt, fill: muted, style: "italic")[
    BioM2 Lab · Department of Ecology and Evolutionary Biology, Cornell University · #link("$website$")[xiangtaoxu.eeb.cornell.edu]
  ]
]
