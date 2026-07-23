# 004-octant-solid-mosaics

2026-07-23T07:43:29.412Z

Iteration 4 — OCTANT MODE (Unicode 16 solid 2x4 mosaics). LIVE.

The big fidelity jump for pure-terminal rendering. Octants give braille's 2x4 resolution but SOLID fills instead of dots — the screen-door dot texture is gone, terrain/sprites read like real pixel art. Ghostty/kitty/foot/WezTerm/VTE draw these with built-in routines that connect across cells.

- Authoritative 256-entry glyph table generated from Unicode 16 name data (python3 unicodedata): 230 octant glyphs + legacy blocks/quadrants/quarter-blocks; 4 nonexistent single-corner patterns approximate to their containing quadrant. octant-chars.ts.
- Same 2-color-per-cell model as braille (contrast split -> fg/bg), so it drops into the existing pipeline; merged-SGR emission; flat cells -> solid full block.
- Auto-selected from the client's TERM (ghostty/kitty/foot/wezterm/contour/vte/rio/alacritty -> octant; else halfblock). MALDOROR_RENDER_MODE overrides; in-game cycle key. Verified live: a ghostty client gets 0 braille, ~36k octant glyphs/session.

Compare showcase_octant_* vs showcase_braille_* : the dot-grid is gone. This is the fidelity layer; the NEXT layer (see docs/RENDERING-CODEC.md) is a terminal-native codec (scroll-region motion compensation + palette-cycled water + dirty-rect entity repair) so this fidelity streams cheaply over SSH.
