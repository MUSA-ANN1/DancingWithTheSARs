# Dancing with the SARs: design system
Source: the owner's own rule list, 2026-10-27. Colour source: NASA brand palette.
THE RULE: this file owns the website chrome (text, panels, controls). The 3D scene uses vector country geometry, a separate city-light texture, and Sun-driven day/night shading; stars, Sun, and Moon use astronomical calculations.

## Tokens (style.css :root)
- --space #000000: page and sky background, true black because space is black
- --surface #051b41: every panel, NASA blue at 45% brightness
- --line #0b3d91: every border and slider track, NASA blue
- --text #ffffff: primary text
- --muted #aeb0b5: secondary text, tick marks (NASA gray)
- --accent #fc3d21: the only accent. Play button, slider thumb, selected tick, focus ring, active history button border
- --radius 4px: the one corner radius on every element

## Type
- Barlow Condensed 700: headings only (h1)
- Inter 400/500/600: everything else
- Scale, ratio 1.25 from 16px: 0.8 / 1 / 1.25 / 1.563 / 1.953 / 2.441 / 3.052 rem. No sizes outside the scale
- Text is left-aligned, max 70ch per line, never centred

## Material rules
1. No drop shadows, no gradients (including text), no purple, no glass or blur on the UI
2. No hover effects. State is shown by focus ring, accent colour and aria-expanded only
3. No floating blobs or circles. No emoji. Icons are Phosphor regular, pinned 2.1.1
4. No scroll animations. The only motion is the intro orbit (3 s) and the 600 ms intro text fade
5. Use real NISAR browse imagery and real city-light imagery. The country surface is the existing vector-map style, not an illustration

## Components
- Panel: --surface fill, 1px --line border, --radius, 16px padding
- History button (top right): opens the date bar. The date bar is hidden until it is pressed, and Escape or the close button hides it again
- Date bar: play button, tick marks at real acquisition dates, thumb snaps to the nearest one
- Empty states: Phosphor icon, one bold sentence saying what happened, one muted sentence saying what to do. States: searching, none found, unreachable, no preview

## Scene rules
- The vector Earth uses country shapes and borders from the repository's TopoJSON data, not decorative illustrations
- City lights are extracted into a separate transparent texture and shown on the night side according to the calculated Sun direction
- Earth never rotates. Users zoom only (wheel, pinch)
- The sky uses a star catalogue, Milky Way outlines, and Sun/Moon positions calculated from date and sidereal time
