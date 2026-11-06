# Dancing with the SARs

**A low-bandwidth, NISAR-powered exploration of coastal-zone observations over the Caspian Sea, with a focus on Turkmenistan.**

Dancing with the SARs is a NASA Space Apps Challenge 2026 project by **Team Hyperia**. It processes real NISAR Level-2 Geocoded Polarimetric Covariance (GCOV) observations on a server, creates compact map products, and displays them in an interactive 3D globe designed to work with relatively limited bandwidth.

> **Important:** The maps are experimental observation and change-screening products. Radar-backscatter differences are not, by themselves, proof of physical shoreline movement. Do not use these outputs as authoritative measurements or as a substitute for field validation.

## What the project currently does

- Searches ASF DAAC for NISAR GCOV observations intersecting the configured Caspian Sea area.
- Groups observations by repeat-pass track, orbit direction, and frame, then pairs the two newest available dates for each matching frame.
- Processes a consistent polarization across the mosaic (HHHH is preferred; HVHV is the fallback) and requires the GCOV quality-mask layer.
- Excludes invalid mask samples before downsampling, converts positive linear backscatter power to dB, aligns overlapping scenes, and blends overlaps to reduce visible granule seams.
- Builds before/after mosaics and experimental water-classification and coastal-zone screening layers.
- Exports compact PNG products and JSON metadata to the separate `data` branch.
- Displays the Caspian observations in a browser-based 3D globe with a historical-date interface and a before/after comparison panel.

The current configured study area is the Caspian Sea basin-wide bounding box. The pipeline currently processes up to 40 repeat-frame pairs and targets a 768-pixel output height; see `server/config.json`.

## Current data products

For the current region, `regions/caspian-sea/` on the `data` branch contains:

| File | Meaning |
|---|---|
| `meta.json` | Processing dates, scene list, frame pairs, quality-mask notes, thresholds, statistics, and image references |
| `before.png` | Earlier-date NISAR backscatter mosaic |
| `after.png` | Later-date NISAR backscatter mosaic |
| `water_before.png` | Experimental water classification for the earlier mosaic |
| `water_after.png` | Experimental water classification for the later mosaic |
| `change.png` | Experimental coastal-zone retreat/advance candidate layer; transparent land/no-candidate pixels |
| `coverage.png` | Valid observation coverage for both dates and single-date-only coverage |
| `reference.png` | Reference-water boundary derived from Natural Earth geography; not a NISAR observation |

The PNGs are encoded with transparency for no-data areas. See the `encoding` field in `meta.json` for the numeric image encoding.

## Processing workflow

The automated workflow is defined in `.github/workflows/nisar.yml`.

1. GitHub Actions installs the Python dependencies in `server/requirements.txt`.
2. It checks that the `EDL_TOKEN` secret is configured.
3. It runs the helper tests in `server/test_*.py`.
4. It runs `server/run_job.py`, which searches ASF for NISAR GCOV granules and invokes the Caspian mosaic processor.
5. `server/publish.sh` publishes the generated compact outputs to the repository's `data` branch.

The main processing code is in:
- `server/run_job.py` — job orchestration, discovery, and output metadata.
- `server/caspian_mosaic.py` — Caspian multi-scene mosaicking, coastal screening, and PNG/JSON generation.
- `server/nisar_lib.py` — HDF5 reading, GCOV mask handling, downsampling, and image utilities.
- `server/test_nisar_lib.py` — automated tests for selected processing helpers.
- `server/config.json` — study area and processing settings.
- `server/publish.sh` — publication of generated files to the `data` branch.

## Website

The website is served through GitHub Pages:

- Main project page: https://musa-ann1.github.io/DancingWithTheSARs/
- Interactive globe: https://musa-ann1.github.io/DancingWithTheSARs/globe.html

The globe and its interface are implemented in the root-level HTML, CSS, and JavaScript files, including `globe.html`, `app.js`, `globe.css`, `world.js`, and supporting scripts. The comparison panel reads the compact products from the `data` branch.

## Scientific limitations

- **Backscatter change is not shoreline displacement.** Wind, waves, surface moisture, vegetation, roughness, radar geometry, and other effects can change radar return without a coastline moving.
- **Water classification is exploratory.** The current workflow uses date-specific Otsu thresholds and a reference coastal zone. Its retreat/advance candidates are screening signals, not validated shoreline measurements.
- **The reference boundary is not an observation.** `reference.png` is derived from Natural Earth land polygons and is used as geographic context.
- **Temporal composites combine multiple acquisitions.** The metadata records the actual date range and individual repeat-frame pairs. A mosaic is not a single-date snapshot.
- **Coverage matters.** Use `coverage.png` and `meta.json` to understand where observations are available. A transparent area is not evidence of no change.
- **No candidate pixels does not mean no environmental change.** It means no pixels met the current screening rules.
- NISAR provisional products are not a substitute for independently validated scientific results. Interpret outputs cautiously and compare them with suitable reference data and field observations before making claims.

## Setup and configuration

The automated GitHub Actions workflow is the current processing route. To run it:

1. Add an Earthdata Login bearer token as the repository Actions secret named `EDL_TOKEN`.
2. Check `server/config.json` for the study-area bounding box, output size, and maximum number of frame pairs.
3. Run the **NISAR Caspian processing** workflow manually from the Actions tab, or push a change to `main`.

Python dependencies are listed in `server/requirements.txt`. The pipeline uses ASF Search, HDF5, NumPy, Rasterio, SciPy, Pillow, PyShp, and related geospatial libraries.

Never commit Earthdata credentials, GitHub tokens, private keys, or other secrets.

## Data and attribution

The project uses NISAR Level-2 GCOV products distributed through the Alaska Satellite Facility (ASF) DAAC and NASA Earthdata. Natural Earth data is used for the reference geography layer.

- NISAR documentation: https://nisar-docs.asf.alaska.edu/
- ASF DAAC: https://asf.alaska.edu/
- NASA Earthdata: https://www.earthdata.nasa.gov/
- Natural Earth: https://www.naturalearthdata.com/

## Team

**Team Hyperia** — NASA Space Apps Challenge 2026, Ashgabat.

- Alyhan Bayryyev — Team leader
- Musa Annagulyyev — Team member
- Sanjar Osmanov — Team member
