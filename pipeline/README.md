# NISAR processing pipeline

## Requirements

- Python 3.11+
- GDAL with HDF5 support and a compatible Rasterio build
- NASA Earthdata Login account
- Enough disk space for two selected granules and intermediate rasters

Install packages:

    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r pipeline/requirements.txt

Configure Earthdata authentication on the server. Follow https://earthaccess.readthedocs.io/en/latest/user/authenticate/

Do not put Earthdata passwords, AWS keys, or GitHub tokens in this repository.

## Run a small test

Choose a small bounding box as west,south,east,north and a date range containing at least two NISAR acquisitions:

    python pipeline/pipeline.py --bbox 58.30,37.70,58.45,37.82 --start 2026-06-17 --end 2026-10-14 --out data/output --max-granules 6

The bounding box is only an example around part of Balkanabat; replace it with your actual study area. Product availability is not guaranteed for this example.

The script searches the provisional GCOV collection, downloads a capped number of matching granules, tries to find a georeferenced HH/VV raster exposed by GDAL, and produces a change raster only if it can identify two compatible scenes.

Outputs:
- manifest.json: dates, filenames, and processing notes
- change_preview.png: compact visual preview
- change_magnitude.tif: georeferenced absolute log-scale difference

## Interpretation

The preview shows relative backscatter change, not a definitive event classification. Radar changes can be caused by moisture, crop cycles, geometry, noise, and other effects. Do not describe a high-change pixel as a confirmed disaster without independent validation.

## Current limitations

- This is a first pipeline stage, not a complete public API.
- NISAR product subdataset layouts vary; inspect logs if the script cannot find an HH/VV raster.
- Pair selection is based on matching search results, not a guaranteed same-orbit/same-track scientific pair.
- The t3.micro may run out of RAM on full granules. Use a small ROI and a stronger instance or cloud processing for larger scenes.
- The website and Android clients should consume manifest.json and the compact preview; full raster delivery/caching still needs deployment work.
