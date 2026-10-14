# Dancing With The SARs — Low-bandwidth NISAR change maps

A server-side pipeline for finding real NISAR L-band observations, preparing compact change products, and serving results to a mobile-friendly website and Android client.

## Scientific limitation

This initial version ranks radar-backscatter change magnitude between two georeferenced observations. It does not reliably label every change as flood, earthquake, landslide, vegetation loss, or construction. Those labels need separate validated methods and suitable products. NISAR does not image every location daily, so comparisons must use actual acquisition dates.

## Architecture

1. pipeline/pipeline.py searches NASA Earthdata for NISAR Level-2 GCOV products for a configured area and date range.
2. It downloads a capped number of products to the server.
3. It looks for a georeferenced HH or VV raster exposed by GDAL, aligns a pair, and calculates absolute log-scale change.
4. It exports a compressed GeoTIFF, a small PNG preview, and a JSON manifest.
5. Clients fetch the manifest and preview first; full raster tiles can be added next.

NISAR products are hosted by NASA Earthdata / ASF DAAC. Earthdata Login is required for downloading. See https://nisar-docs.asf.alaska.edu/ and https://nisar-docs.asf.alaska.edu/earthaccess/.

## Deployment notes

- Run on an EC2 instance with enough disk and memory. A t3.micro is suitable for a tiny API but may not have enough RAM for large raster processing. Start with a very small area/date window.
- Keep Earthdata credentials out of Git. Configure Earthaccess authentication on the server and never commit credentials.
- Keep processed raster files in object storage or on the server. GitHub should store code and small manifests, not bulk satellite imagery.
- Verify product subdatasets before relying on outputs: GDAL's visibility of NISAR HDF5 layers depends on its build and product structure.

See pipeline/README.md for setup and commands.

## Status

This repository contains the initial server-side pipeline scaffold. A competition-ready deployment still needs a chosen study area, verified product pair, end-to-end test on EC2, and frontend/API deployment.
