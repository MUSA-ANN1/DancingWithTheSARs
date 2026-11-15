#!/usr/bin/env python3
"""Search/download a small NISAR GCOV sample and create a backscatter-change preview.

This is conservative: it stops rather than inventing geospatial metadata when GDAL
cannot expose a suitable georeferenced HH/VV raster.
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from datetime import datetime, timezone

import earthaccess
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.enums import Resampling as RioResampling

LOG = logging.getLogger("nisar-pipeline")
COLLECTION = "NISAR_L2_GCOV_PROVISIONAL_V1"

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--bbox", required=True, help="west,south,east,north in decimal degrees")
    p.add_argument("--start", required=True, help="YYYY-MM-DD")
    p.add_argument("--end", required=True, help="YYYY-MM-DD")
    p.add_argument("--out", default="data/output")
    p.add_argument("--max-granules", type=int, default=6)
    p.add_argument("--max-pixels", type=int, default=3_000_000,
                   help="Downsample large rasters to bound memory use")
    return p.parse_args()

def parse_bbox(value: str):
    values = tuple(float(v.strip()) for v in value.split(","))
    if len(values) != 4:
        raise ValueError("bbox must be west,south,east,north")
    west, south, east, north = values
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("Invalid bbox coordinate order/range")
    return values

def find_raster_subdataset(h5_path: Path):
    """Return a georeferenced HH/VV subdataset if GDAL exposes one."""
    try:
        with rasterio.open(h5_path) as root:
            subdatasets = list(root.subdatasets or [])
    except Exception as exc:
        LOG.warning("Could not inspect %s: %s", h5_path.name, exc)
        return None

    preferred = [
        name for name in subdatasets
        if any(token in name.upper() for token in ("HHHH", "VVVV", "HH_POWER", "VV_POWER"))
    ]
    for name in preferred + subdatasets:
        try:
            with rasterio.open(name) as ds:
                if ds.count >= 1 and ds.width > 1 and ds.height > 1 and ds.crs:
                    return name
        except Exception:
            continue
    return None

def read_resampled(path: str, max_pixels: int):
    with rasterio.open(path) as src:
        scale = min(1.0, (max_pixels / max(1, src.width * src.height)) ** 0.5)
        width = max(2, int(src.width * scale))
        height = max(2, int(src.height * scale))
        data = src.read(1, out_shape=(height, width), resampling=RioResampling.average).astype("float32")
        transform = src.transform * src.transform.scale(src.width / width, src.height / height)
        profile = src.profile.copy()
        profile.update(width=width, height=height, transform=transform, count=1, dtype="float32")
        return data, profile

def align_to_reference(data, src_profile, ref_profile):
    out = np.full((ref_profile["height"], ref_profile["width"]), np.nan, dtype="float32")
    reproject(
        source=data,
        destination=out,
        src_transform=src_profile["transform"],
        src_crs=src_profile["crs"],
        dst_transform=ref_profile["transform"],
        dst_crs=ref_profile["crs"],
        resampling=Resampling.bilinear,
        src_nodata=src_profile.get("nodata"),
        dst_nodata=np.nan,
    )
    return out

def main():
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    bbox = parse_bbox(args.bbox)
    if args.max_granules < 2:
        raise SystemExit("--max-granules must be at least 2")
    out_dir = Path(args.out)
    downloads = out_dir / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)

    LOG.info("Logging in to NASA Earthdata using configured credentials")
    earthaccess.login()

    LOG.info("Searching collection %s", COLLECTION)
    results = earthaccess.search_data(
        short_name=COLLECTION,
        bounding_box=bbox,
        temporal=(args.start, args.end),
        count=args.max_granules,
    )
    if len(results) < 2:
        raise SystemExit(
            f"Only {len(results)} granule(s) found. Widen the dates/area or choose another "
            "NISAR collection; at least two observations are needed."
        )

    LOG.info("Found %d granules; downloading at most %d", len(results), args.max_granules)
    downloaded = earthaccess.download(results[:args.max_granules], local_path=str(downloads))
    files = [Path(p) for p in downloaded if str(p).lower().endswith((".h5", ".hdf5"))]
    if len(files) < 2:
        files = sorted(downloads.rglob("*.h5")) + sorted(downloads.rglob("*.hdf5"))
    if len(files) < 2:
        raise SystemExit("Fewer than two HDF5 products were found after download.")

    candidates = []
    for path in files:
        subdataset = find_raster_subdataset(path)
        if subdataset:
            candidates.append({"file": path, "subdataset": subdataset})
            LOG.info("Found candidate raster in %s", path.name)
        else:
            LOG.warning("No georeferenced HH/VV subdataset exposed by GDAL in %s", path.name)

    if len(candidates) < 2:
        raise SystemExit(
            "Could not find two georeferenced HH/VV layers. Inspect GDAL/HDF5 support and "
            "the product subdatasets; the script will not guess georeferencing."
        )

    first, second = candidates[0], candidates[1]
    a, profile_a = read_resampled(first["subdataset"], args.max_pixels)
    b, profile_b = read_resampled(second["subdataset"], args.max_pixels)
    if profile_a["crs"] is None or profile_b["crs"] is None:
        raise SystemExit("Missing CRS; cannot safely align observations.")

    b_aligned = align_to_reference(b, profile_b, profile_a)
    valid = np.isfinite(a) & np.isfinite(b_aligned) & (a > 0) & (b_aligned > 0)
    if int(valid.sum()) < 100:
        raise SystemExit("Too few overlapping valid pixels; choose another pair/ROI.")

    change = np.full(a.shape, np.nan, dtype="float32")
    change[valid] = np.abs(10.0 * np.log10(a[valid]) - 10.0 * np.log10(b_aligned[valid]))

    tif_path = out_dir / "change_magnitude.tif"
    profile = profile_a.copy()
    profile.update(driver="GTiff", dtype="float32", count=1, nodata=-9999.0,
                   compress="DEFLATE", predictor=3, tiled=True)
    output = np.where(np.isfinite(change), change, -9999.0).astype("float32")
    with rasterio.open(tif_path, "w", **profile) as dst:
        dst.write(output, 1)
        dst.set_band_description(1, "Absolute log-scale backscatter change (dB-like)")

    vals = change[np.isfinite(change)]
    vmax = float(np.nanpercentile(vals, 98))
    if not np.isfinite(vmax) or vmax <= 0:
        vmax = 1.0
    preview_path = out_dir / "change_preview.png"
    fig, ax = plt.subplots(figsize=(7, 5), dpi=110)
    im = ax.imshow(change, vmin=0, vmax=vmax, cmap="magma")
    ax.set_title("NISAR backscatter change magnitude")
    ax.set_axis_off()
    fig.colorbar(im, ax=ax, shrink=0.78, label="Absolute log-scale difference (dB-like)")
    fig.tight_layout()
    fig.savefig(preview_path, format="png", optimize=True)
    plt.close(fig)

    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": "NASA Earthdata / NISAR L2 GCOV provisional",
        "collection": COLLECTION,
        "bbox_wsen": list(bbox),
        "requested_date_range": {"start": args.start, "end": args.end},
        "scenes": [
            {"filename": first["file"].name, "raster_subdataset": first["subdataset"]},
            {"filename": second["file"].name, "raster_subdataset": second["subdataset"]},
        ],
        "products": {"preview": preview_path.name, "change_geotiff": tif_path.name},
        "valid_pixel_count": int(valid.sum()),
        "change_percentiles": {
            "p50": float(np.nanpercentile(vals, 50)),
            "p90": float(np.nanpercentile(vals, 90)),
            "p98": float(np.nanpercentile(vals, 98)),
        },
        "interpretation": (
            "Relative backscatter-change strength only; not an event classification. "
            "High change can reflect moisture, vegetation, geometry, noise, or real surface change."
        ),
        "limitations": [
            "Pair compatibility and orbit geometry must be verified before scientific claims.",
            "Not all change categories are classified by this output.",
            "The output is valid only if selected subdatasets are calibrated positive linear backscatter/power.",
        ],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    LOG.info("Done. Outputs: %s, %s, %s", tif_path, preview_path, out_dir / "manifest.json")

if __name__ == "__main__":
    main()
