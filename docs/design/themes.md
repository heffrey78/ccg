# Themes

Requirement #122 · tasks #135 (format and client), #136 (editor), #137 (Sporeline)

A game's look is content, like its cards. A package can hold a `theme` item
(`content/themes/<id>.json`); the game uses the first theme in its own
package. A game without a theme looks as it always has.

## What a theme sets

| Field | What it does |
| --- | --- |
| `colors` | The client's colour tokens: `page`, `panel`, `ink`, `muted`, `line`, `accent` (behind white text), `accentText` (text in the accent colour, for dark themes where the accent is too dark to read on a panel), `cell`, `mine`, `enemy`, `threat`, `hp`, `block`, `reaction`, `target`. Hex only. Any left out keep the default. A theme's colours apply in light and dark mode alike. |
| `fonts.body`, `fonts.display` | A font `family`, and optionally a `font` file in the package (woff2, woff, ttf, otf). Display is for headings and card names. |
| `table` | A `color` and a `background` image behind the play area. |
| `frames` | Card frames: `fill`, a `background` image stretched over the face, `border`, `borderWidth`, `radius`, `ink` (text), `accent` (the cost badge) and a `layout`. |
| `defaultFrame` | The frame for cards no frame matches. Without one, they keep the plain card. |
| `sounds` | Audio files in the package that replace built-in sounds: a list of `cue` and `sound`. Any cue left out keeps its built-in sound. Use ogg or mp3, which every platform plays. |

Sound cues: `card`, `move`, `hit`, `block`, `heal`, `status`, `death`, `spawn`,
`win` and `lose`. A file that's missing or won't decode falls back to the
built-in sound, and the editor warns about a missing one.

A card's frame is the first frame whose `match.tags` shares a tag with the
card, else the first whose `match.rarity` lists the card's rarity, else the
default.

Layouts:

- **standard**: name, art, text (the plain card's arrangement);
- **art-first**: the art runs edge to edge across the top, then name and text;
- **full-art**: the art fills the card; the name and text sit on translucent
  bands over it.

## How it reaches the screen

The host resolves the theme into the catalog (`catalog.theme`), with every
asset path turned into a URL, and gives each card face its `frame`. The
client turns the theme into a stylesheet scoped to the encounter screen
(`themeCss`). Cards carry `data-frame`, so frames are plain CSS rules.

## In the editor

Themes edit like other items, with colour pickers and a live preview: the
table, a panel, a small board with the first encounter's units, and a sample
card in each frame. Validation warns (it doesn't block) where text falls below
WCAG AA, 4.5:1: text and secondary text on panels, text on the page or table,
white text on the accent, accent-coloured text on panels, and each frame's
text and cost badge.

Sporeline's theme, `games/reference/content/themes/loam.json`, is the worked
example.

Nothing in a theme is code. Colours must be hex, font family names allow only
letters, digits, spaces, `-` and `_`, and ids follow the content id pattern,
so the generated CSS can't be escaped from content.
