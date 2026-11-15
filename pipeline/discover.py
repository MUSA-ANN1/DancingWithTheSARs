#!/usr/bin/env python3
"""Discover NISAR GCOV and GUNW granules for a region/date window.

This lightweight step lists candidate observations before any large downloads.
It intentionally does not treat GUNW granules as ordinary dated images: each GUNW
is already an interferometric product derived from a pair of acquisitions.
"""
from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import earthaccess

LOG = logging.getLogger("nisar-discovery")
COLLECTIONS = {
    "GCOV": "NISAR_L2_GCOV_PROVISIONAL_V1",
    "GUNW": "NISAR_L2_GUNW_PROVISIONAL_V1",
}


def parse_bbox(value: str):
    parts = tuple(float(v.strip()) for v in value.split(","))
    if len(parts) != 4:
        raise ValueError("bbox must be west,south,east,north")
    west, south, east, north = parts
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("bbox must be west,south,east,north in valid longitude/latitude ranges")
    return parts


def granule_fields(item):
    """Extract stable fields while tolerating variations in CMR metadata."""
    umm = item.get("umm", {}) if isinstance(item, dict) else {}
    temporal = umm.get("TemporalExtent", {}).get("RangeDateTime", {})
    spatial = umm.get("SpatialExtent", {})
    return {
        "granule_id": umm.get("GranuleUR"),
        "producer_granule_id": umm.get("ProducerGranuleId"),
        "beginning": temporal.get("BeginningDateTime"),
        "ending": temporal.get("EndingDateTime"),
        "native_id": item.get("meta", {}).get("native-id") if isinstance(item, dict) else None,
        "collection": umm.get("CollectionReference", {}).get("ShortName"),
        "spatial_extent_metadata_present": bool(spatial),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", required=True, help="west,south,east,north decimal degrees")
    parser.add_argument("--start", required=True, help="YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="YYYY-MM-DD")
    parser.add_argument("--out", default="data/discovery.json")
    parser.add_argument("--max-per-product", type=int, default=20)
    parser.add_argument("--products", nargs="+", choices=["GCOV", "GUNW"], default=["GCOV", "GUNW"])
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    bbox = parse_bbox(args.bbox)
    earthaccess.login()
    inventory = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "bbox_wsen": list(bbox),
        "date_range": {"start": args.start, "end": args.end},
        "collections": {},
        "notes": [
            "GCOV is used for backscatter/covariance change analysis between compatible acquisitions.",
            "GUNW is already an interferometric product for a pair; use its unwrapped-phase, coherence, mask, and correction layers with product-specific quality control.",
            "Discovery results are candidates only; confirm acquisition geometry, layer names, quality flags, and overlap before scientific interpretation.",
        ],
    }

    for product in args.products:
        short_name = COLLECTIONS[product]
        LOG.info("Searching %s", short_name)
        try:
            results = earthaccess.search_data(
                short_name=short_name,
                bounding_box=bbox,
                temporal=(args.start, args.end),
                count=args.max_per_product,
            )
        except Exception as exc:
            LOG.exception("Search failed for %s", short_name)
            inventory["collections"][product] = {"short_name": short_name, "error": str(exc), "granules": []}
            continue

        inventory["collections"][product] = {
            "short_name": short_name,
            "result_count_returned": len(results),
            "granules": [granule_fields(item) for item in results],
        }
        LOG.info("%s: %d granules returned", product, len(results))

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(inventory, indent=2), encoding="utf-8")
    LOG.info("Wrote inventory to %s", out_path)


if __name__ == "__main__":
    main()
