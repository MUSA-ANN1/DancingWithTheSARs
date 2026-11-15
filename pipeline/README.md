# NISAR processing pipeline

This project uses two separate provisional Level-2 product families:
- **GCOV** (NISAR_L2_GCOV_PROVISIONAL_V1) for radiometrically terrain-corrected backscatter/covariance analysis and change screening.
- **GUNW** (NISAR_L2_GUNW_PROVISIONAL_V1) for interferometric phase/coherence analysis and potential ground-displacement studies.

These workflows are not interchangeable. A GUNW granule is already an interferometric product for an acquisition pair; do not treat it as a simple Day 1 image to subtract from another GUNW. Any displacement interpretation needs phase conventions, coherence/mask screening, corrections, and scientific validation.

## Requirements

- Python 3.11+
- NASA Earthdata Login account
- earthaccess
- For raster processing: GDAL/HDF5 support and a compatible Rasterio build

Install Python packages:

    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r pipeline/requirements.txt

Configure Earthdata authentication on the server. Follow https://earthaccess.readthedocs.io/en/latest/user/authenticate/

Never commit Earthdata passwords, AWS keys, GitHub tokens, .netrc, or private keys.

## First step: discover both collections

Start with metadata discovery before downloading large files. It writes a compact JSON inventory and does not download granules:

    python pipeline/discover.py --bbox 58.30,37.70,58.45,37.82 --start 2026-06-17 --end 2026-10-14 --out data/discovery.json --max-per-product 20

The bounding box is only an example around part of Balkanabat. Replace it with your real study area; product availability is not guaranteed. Use a date window that contains actual observations.

To search only one family, append --products GCOV or --products GUNW.

## GCOV processing prototype

    python pipeline/pipeline.py --bbox 58.30,37.70,58.45,37.82 --start 2026-06-17 --end 2026-10-14 --out data/output --max-granules 6

The current pipeline.py is an early GCOV backscatter-change prototype. It searches the provisional GCOV collection, downloads a capped number of granules, and attempts to find compatible georeferenced HH/VV layers. It may require changes for the exact GDAL-visible layer names and product structure; it has not yet been validated against a real downloaded granule.

Expected outputs if processing succeeds:
- manifest.json: scene metadata and processing notes
- change_preview.png: compact preview
- change_magnitude.tif: georeferenced change-strength raster

## Important scientific limitations

- A high-change pixel is not automatically a flood, earthquake, landslide, or other confirmed event.
- GCOV change can reflect soil moisture, vegetation, surface roughness, acquisition geometry, noise, and genuine surface changes.
- GUNW phase must not be interpreted as displacement without checking phase conventions, coherence, connected-component/mask layers, atmospheric/ionospheric contributions, and other corrections.
- The provisional products are partially validated. Show uncertainty and source dates in the user interface.
- NISAR does not observe every location every day. Use actual acquisition dates; never fabricate consecutive daily observations.

## Deployment constraints

- A t3.micro can host a small API and serve compact files, but full-granule processing may exceed its memory. Begin with metadata discovery and a very small region.
- GitHub stores code and small manifests, not bulk satellite data. Store imagery in object storage or on the server and serve compact previews/tiles to the clients.
- The website and Android app, API, cache headers, offline tile cache, event ranking, and product-specific GUNW analysis are not implemented yet.
