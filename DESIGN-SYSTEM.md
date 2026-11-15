# Dancing with the SARs: design system
Source: the owner's own rule list, 2026-10-27. Colour source: NASA brand palette.
THE RULE: this file owns the website chrome (text, panels, controls). The 3D scene uses vector country geometry, a separate city-light texture, and Sun-driven day/night shading; stars, Sun, and Moon use astronomical calculations.

## Tokens (globe.css :root)
- --space #000000: page and sky background
- --surface #051b41: every panel, NASA blue at 45% brightness
- --line #0b3d91: every border, divider and available-date cell (NASA blue)
- --text #ffffff: primary text
- --muted #aeb0b5: secondary text (NASA gray)
- --accent #fc3d21: the only accent (NASA red). It means "selected" or "change": active Before/After option, selected calendar day, open-button border, focus ring, and the change colour on the map and in the legend
- --on-accent #000000: text on the accent. White on this red is only 3.6:1, black is 5.8:1
- --radius 4px: the one corner radius on every element

## Type
- Barlow Condensed 700: headings and the big date readout
- Inter 400/500/600: everything else
- Scale, ratio 1.25 from 16px: 0.8 / 1 / 1.25 / 1.563 / 1.953 / 2.441 / 3.052 rem. No sizes outside the scale
- Text is left-aligned, max 70ch per line, never centred

## Material rules
1. No drop shadows, no gradients (including text), no purple, no glass or blur on the UI
2. No hover effects. State is shown by the accent, aria-pressed and aria-expanded only
3. No floating blobs or circles. No emoji. Icons are Phosphor regular, pinned 2.1.1
4. No scroll animations. The only motion is the intro orbit and the 600 ms intro text fade
5. Real imagery only: NISAR mosaics from the data branch, NISAR browse previews from ASF, real city lights

## Layout (desktop)
- Top left: eyebrow, title, one-line description. The intro text sits in the same place
- Under it: the comparison panel (image with Before/After switch on it, big date readout, product and area, explanation, ASF link)
- Bottom left: colour key. Accent swatch plus the word "Change". The same colour marks change on the globe. An outlined swatch means no change was detected
- Top right: menu button, then the historical imagery button under it. Both 44px, icons only
- Calendar: opens under those buttons and runs to the bottom. Month grid, days with data are NASA blue, the selected day is the accent. Earlier and Later buttons and an "All dates" list jump between dates. Arrow keys also step between dates
- Menu items and settings open to the left of the buttons. The calendar and settings never show together

## Layout (phone)
- The comparison panel starts collapsed to its header. Picking a date expands it
- The calendar becomes a bottom sheet. The long date list is hidden, the grid and Earlier/Later remain

## Empty and error states
Phosphor icon, one bold sentence saying what happened, one muted sentence saying what to do. Used for: loading, no preview for a date, image failed, mosaics unreachable, archive search failed, no dates found

## Scene rules
- Vector Earth from the repository TopoJSON, city lights as a separate night layer, Sun-driven day/night shading
- The Caspian highlight is NASA blue. The change layer is drawn in the accent colour from change.png, each marked pixel grown by one so it stays visible at globe scale
- Earth never rotates. Users zoom only (wheel, pinch)
- The sky uses a star catalogue, Milky Way outlines, and Sun/Moon positions from date and sidereal time
