"""Reading NISAR HDF5, shrinking it, and naming the cause. No network except USGS/FIRMS."""
import math, os, re, warnings
import numpy as np, h5py
from PIL import Image

WAVELENGTH_M = 0.2384            # L-band, approximate. Check the product metadata.
RED, BLUE = (252, 61, 33, 210), (94, 134, 204, 210)

def parse_name(n):
    """NISAR_L2_PR_GCOV_<cycle>_<track>_<dir>_<frame>_..._<start time>_..."""
    p = n.split("_")
    y, m, d = re.search(r"(\d{4})(\d{2})(\d{2})T", n).groups()
    return dict(track=p[5], dir=p[6], frame=p[7], date=f"{y}-{m}-{d}")

def find(f, name):
    hits = []
    f.visititems(lambda p, o: hits.append(p) if isinstance(o, h5py.Dataset) and p.split("/")[-1] == name else None)
    return [h for h in hits if "frequencyA" in h]

def grid_group(f, path):
    parts = path.split("/")
    for i in range(len(parts) - 1, 0, -1):
        g = f["/".join(parts[:i])]
        if "xCoordinates" in g and "yCoordinates" in g: return g
    raise RuntimeError("No xCoordinates/yCoordinates near " + path)

def epsg_of(g):
    d = g["projection"]; v = d.attrs.get("epsg_code", d[()])
    return int(np.asarray(v).reshape(-1)[0])

def blockmean(ds, step, positive_only=False, budget=32e6):
    """Average step x step blocks. Reads a few rows at a time so 1 GB of RAM is enough."""
    R, C = ds.shape[0] // step * step, ds.shape[1] // step * step
    rows = max(step, int(budget / (C * 4)) // step * step)
    out = []
    for r in range(0, R, rows):
        a = ds[r:min(r + rows, R), :C].astype("float32")
        if positive_only: a[a <= 0] = np.nan
        h = a.shape[0] // step * step
        with warnings.catch_warnings(), np.errstate(all="ignore"):
            warnings.simplefilter("ignore")
            out.append(np.nanmean(a[:h].reshape(h // step, step, C // step, step), axis=(1, 3)))
    return np.vstack(out)

def load(path, mode, target=512, step=None, pols=None):
    with h5py.File(path, "r") as f:
        if mode == "gcov":
            for pol in (pols or ("HVHV", "HHHH")):
                h = find(f, pol)
                if h: break
            if not h: raise RuntimeError("No HHHH/HVHV in " + path)
            ds, pol, sib = f[h[0]], pol, None
        else:
            h = sorted(find(f, "unwrappedPhase"), key=lambda p: "/HH/" not in p)
            if not h: raise RuntimeError("No unwrappedPhase in " + path)
            ds = f[h[0]]; sib = ds.parent; pol = h[0].split("/")[-2]
        step = step or max(1, math.ceil(max(ds.shape) / target))
        arr = blockmean(ds, step, mode == "gcov")
        coh = blockmean(sib["coherenceMagnitude"], step) if sib is not None and "coherenceMagnitude" in sib else None
        g = grid_group(f, h[0])
        x = g["xCoordinates"][:arr.shape[1] * step].reshape(-1, step).mean(1)
        y = g["yCoordinates"][:arr.shape[0] * step].reshape(-1, step).mean(1)
        return dict(a=arr, coh=coh, pol=pol, x=x, y=y, epsg=epsg_of(g), step=step)

def crop_pair_to_region(A, B, x, y, epsg, lon, lat, half_width_km=35):
    """Crop aligned rasters to a square around the requested lon/lat.

    x/y are projected coordinate vectors corresponding to A/B after overlap().
    A 70 km square keeps the two configured Caspian study areas separate.
    """
    from pyproj import Transformer
    to_xy = Transformer.from_crs(4326, epsg, always_xy=True)
    cx, cy = to_xy.transform(float(lon), float(lat))
    radius = float(half_width_km) * 1000.0
    cols = np.flatnonzero((x >= cx - radius) & (x <= cx + radius))
    rows = np.flatnonzero((y >= cy - radius) & (y <= cy + radius))
    if cols.size < 2 or rows.size < 2:
        raise RuntimeError(
            f"Requested region ({lon}, {lat}) is not covered by the aligned "
            f"NISAR overlap at a usable resolution; crop has {cols.size} columns "
            f"and {rows.size} rows."
        )
    c0, c1 = int(cols[0]), int(cols[-1]) + 1
    r0, r1 = int(rows[0]), int(rows[-1]) + 1

    if x.min() > cx or x.max() < cx or y.min() > cy or y.max() < cy:
        raise RuntimeError(f"NISAR overlap does not contain target center ({lon}, {lat}).")
    return A[r0:r1, c0:c1], B[r0:r1, c0:c1], x[c0:c1], y[r0:r1]

def overlap(p, q):
    dx, dy = p["x"][1] - p["x"][0], p["y"][1] - p["y"][0]
    ox, oy = (q["x"][0] - p["x"][0]) / dx, (q["y"][0] - p["y"][0]) / dy
    if p["epsg"] != q["epsg"] or abs(ox - round(ox)) > .05 or abs(oy - round(oy)) > .05:
        raise RuntimeError("Grids are not aligned (different frame or projection).")
    ox, oy = int(round(ox)), int(round(oy))
    r0, r1 = max(0, oy), min(p["a"].shape[0], oy + q["a"].shape[0])
    c0, c1 = max(0, ox), min(p["a"].shape[1], ox + q["a"].shape[1])
    if r1 <= r0 or c1 <= c0: raise RuntimeError("The two passes do not overlap.")
    return p["a"][r0:r1, c0:c1], q["a"][r0 - oy:r1 - oy, c0 - ox:c1 - ox], p["x"][c0:c1], p["y"][r0:r1]

def bbox_of(x, y, epsg):
    from pyproj import Transformer
    t = Transformer.from_crs(epsg, 4326, always_xy=True)
    lons, lats = zip(*[t.transform(a, b) for a in (x.min(), x.max()) for b in (y.min(), y.max())])
    return [round(min(lons), 4), round(min(lats), 4), round(max(lons), 4), round(max(lats), 4)]

def otsu(v, lo=-35.0, hi=5.0, bins=160):
    """Threshold (dB) that best splits dark (water) from bright (land) pixels."""
    v = v[np.isfinite(v)]
    if v.size < 100: return None
    h, e = np.histogram(np.clip(v, lo, hi), bins=bins, range=(lo, hi))
    p = h / h.sum(); c = (e[:-1] + e[1:]) / 2
    w = np.cumsum(p); m = np.cumsum(p * c)
    with np.errstate(all="ignore"): sb = (m[-1] * w - m) ** 2 / (w * (1 - w))
    return float(c[np.nanargmax(sb)])

def quant_png(a, lo, hi, path):
    """RGBA: R=G=B=v (1..255), alpha 255 where valid, 0 = no data. value = lo + (v-1)/254*(hi-lo)."""
    ok = np.isfinite(a); v = np.zeros(a.shape, np.uint8)
    v[ok] = (np.clip((a[ok] - lo) / (hi - lo), 0, 1) * 254 + 1).astype(np.uint8)
    Image.fromarray(np.dstack([v, v, v, np.where(ok, 255, 0).astype(np.uint8)]), "RGBA").save(path, optimize=True)

def overlay_png(loss, gain, path):
    img = np.zeros(loss.shape + (4,), np.uint8); img[loss] = RED; img[gain] = BLUE
    Image.fromarray(img, "RGBA").save(path, optimize=True)

def usgs(bb, d1, d2):
    import requests
    r = requests.get("https://earthquake.usgs.gov/fdsnws/event/1/query", timeout=30, params=dict(
        format="geojson", starttime=d1, endtime=d2, minmagnitude=4.5,
        minlongitude=bb[0] - 1, minlatitude=bb[1] - 1, maxlongitude=bb[2] + 1, maxlatitude=bb[3] + 1))
    return [f"USGS M{f['properties']['mag']} {f['properties']['place']}" for f in r.json()["features"]]

def firms(bb, d1, days=10):
    import requests
    key = os.environ.get("FIRMS_KEY")
    if not key: return []
    u = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_SP/{bb[0]},{bb[1]},{bb[2]},{bb[3]}/{min(days,10)}/{d1}"
    n = len(requests.get(u, timeout=60).text.strip().splitlines()) - 1
    return [f"NASA FIRMS: {n} fire detections"] if n > 0 else []

def classify(mode, s, pol, bb, d1, d2):
    ev = []
    for fn, args in ((usgs, (bb, d1, d2)), (firms, (bb, d1))):
        if fn is firms and mode != "gcov": continue
        try: ev += fn(*args)
        except Exception as e: print("  event lookup skipped (%s): %s" % (fn.__name__, str(e)[:80]))
    if mode == "gunw":
        if any(e.startswith("USGS") for e in ev): return "Earthquake", "event-confirmed", ev
        return ("Ground deformation" if s["changed"] > .01 else "No clear change"), "radar-only", ev
    if any("FIRMS" in e for e in ev) and s["loss"] > .01: return "Fire", "event-confirmed", ev
    if s["loss"] > s["gain"]:
        return ("Flood or inundation" if pol == "HHHH" and s["mean_loss"] < -6 else "Vegetation loss"), "radar-only", ev
    return ("Vegetation growth or flooded vegetation" if s["gain"] > .01 else "No clear change"), "radar-only", ev
