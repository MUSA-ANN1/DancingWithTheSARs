#!/usr/bin/env python3
"""
Server job: find the newest real NISAR passes for each region, shrink them, write small
PNG + JSON files into OUT_DIR. publish.sh then pushes OUT_DIR to the GitHub `data` branch.

  python run_job.py                       # all regions in config.json
  python run_job.py --region venezuela    # one region
  python run_job.py --force               # redo even if nothing new
  python run_job.py --local A.h5 B.h5 --mode gcov --name test --label Test --lon 0 --lat 0
"""
import argparse, datetime as dt, json, os, shutil, sys, tempfile, time
from collections import defaultdict
from pathlib import Path
import numpy as np
import nisar_lib as L

HERE = Path(__file__).resolve().parent
OUT = Path(os.environ.get("OUT_DIR", "/opt/nisar/out"))
TMP = Path(os.environ.get("TMP_DIR", "/opt/nisar/tmp"))
STATE = Path(os.environ.get("STATE_FILE", "/opt/nisar/state.json"))
DB_RANGE, CM_RANGE = (-30.0, 0.0), (-20.0, 20.0)
ENCODING = "PNG RGBA: R=G=B=v, alpha 255 = valid, 0 = no data. value = lo + (v-1)/254*(hi-lo)"

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)

# ---------- choose passes ----------
def name_of(p): return p.properties.get("sceneName") or p.properties.get("fileID")

def pick_pair(products):
    """Newest two dates that share the same track, direction and frame. Only those can be subtracted."""
    g = defaultdict(dict)
    for p in products:
        try: q = L.parse_name(name_of(p))
        except Exception: continue
        g[(q["track"], q["dir"], q["frame"])][q["date"]] = p
    best = None
    for v in g.values():
        if len(v) >= 2:
            ds = sorted(v)[-2:]
            if not best or ds[-1] > best[0]: best = (ds[-1], [v[ds[0]], v[ds[1]]])
    return best[1] if best else None

def search(r, level):
    import asf_search as asf
    end = dt.date.today() + dt.timedelta(days=1); start = end - dt.timedelta(days=r.get("days", 45))
    return list(asf.search(dataset="NISAR", processingLevel=level, intersectsWith=f"POINT({r['lon']} {r['lat']})",
                           start=start.isoformat(), end=end.isoformat(), maxResults=200))

# ---------- build outputs ----------
def finish(r, meta, rd):
    meta.update(name=r["name"], label=r.get("label", r["name"]), lon=r["lon"], lat=r["lat"], encoding=ENCODING,
                updated=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
    (rd / "meta.json").write_text(json.dumps(meta, indent=1))
    return meta

def write_gcov(r, f1, f2, scenes, target):
    p = L.load(f1, "gcov", target); q = L.load(f2, "gcov", target, step=p["step"])
    A, B, x, y = L.overlap(p, q)
    a, b = 10 * np.log10(A), 10 * np.log10(B); diff = b - a
    d1, d2 = [L.parse_name(os.path.basename(f))["date"] for f in (f1, f2)]
    rd = OUT / "regions" / r["name"]; rd.mkdir(parents=True, exist_ok=True)
    L.quant_png(a, *DB_RANGE, rd / "before.png"); L.quant_png(b, *DB_RANGE, rd / "after.png")
    ok = np.isfinite(diff); loss, gain = ok & (diff < -3), ok & (diff > 3); n = max(int(ok.sum()), 1)
    s = dict(loss=loss.sum() / n, gain=gain.sum() / n, mean_loss=float(np.mean(diff[loss])) if loss.any() else 0.0)
    s["changed"] = s["loss"] + s["gain"]; s = {k: round(float(v), 4) for k, v in s.items()}
    bb = L.bbox_of(x, y, p["epsg"]); L.overlay_png(loss, gain, rd / "change.png")
    cat, conf, ev = L.classify("gcov", s, p["pol"], bb, d1, d2)
    return finish(r, dict(type="pair", mode="gcov", before=d1, after=d2, bbox=bb, size=[a.shape[1], a.shape[0]],
        pol=p["pol"], unit="dB", range=list(DB_RANGE), threshold=3, stats=s, level=round(min(1, s["changed"] / .25), 3),
        category=cat, confidence=conf, evidence=ev, scenes=scenes,
        images=dict(before="before.png", after="after.png", change="change.png")), rd)

def write_gunw(r, f, scenes, target, d2, d1):
    p = L.load(f, "gunw", target)
    d = p["a"] * L.WAVELENGTH_M / (4 * np.pi) * 100            # radians -> cm along line of sight
    if p["coh"] is not None: d[p["coh"] < 0.3] = np.nan
    d -= np.nanmedian(d)
    rd = OUT / "regions" / r["name"]; rd.mkdir(parents=True, exist_ok=True)
    L.quant_png(d, *CM_RANGE, rd / "diff.png")
    ok = np.isfinite(d); mv = ok & (np.abs(d) > 2)
    n = max(int(ok.sum()), 1); loss, gain = ok & (d < -2), ok & (d > 2)
    s = dict(changed=float(mv.sum() / n), p95_abs_cm=float(np.nanpercentile(np.abs(d), 95)) if ok.any() else 0.0)
    s = {k: round(v, 4) for k, v in s.items()}
    bb = L.bbox_of(p["x"], p["y"], p["epsg"]); L.overlay_png(loss, gain, rd / "change.png")
    cat, conf, ev = L.classify("gunw", s, p["pol"], bb, d1, d2)
    return finish(r, dict(type="diff", mode="gunw", before=d1, after=d2, bbox=bb, size=[d.shape[1], d.shape[0]],
        pol=p["pol"], unit="cm", range=list(CM_RANGE), threshold=2, stats=s, level=round(min(1, s["p95_abs_cm"] / 10), 3),
        category=cat, confidence=conf, evidence=ev, scenes=scenes,
        images=dict(diff="diff.png", change="change.png")), rd)

# ---------- one region, from the real archive ----------
def run_region(r, session, force, state, target):
    t0 = time.time(); mode = r.get("mode", "gcov")
    if mode == "gcov":
        prods = pick_pair(search(r, "GCOV"))
        if not prods: raise RuntimeError("no same-track GCOV pair in the last %s days" % r.get("days", 45))
    else:
        res = search(r, "GUNW")
        if not res: raise RuntimeError("no GUNW product in the last %s days" % r.get("days", 45))
        prods = [max(res, key=lambda p: p.properties["startTime"])]
    scenes = [name_of(p) for p in prods]
    if not force and state.get(r["name"]) == scenes and (OUT / "regions" / r["name"] / "meta.json").exists():
        return log(r["name"], "nothing new, skipped")
    log(r["name"], "downloading", scenes)
    tmps, files = [], []
    try:
        for p in prods:
            d = Path(tempfile.mkdtemp(dir=TMP)); tmps.append(d)
            p.download(path=str(d), session=session)
            files.append(next(d.glob("*.h5")))
        dl = time.time() - t0; log(r["name"], "computing")
        if mode == "gcov": meta = write_gcov(r, files[0], files[1], scenes, target)
        else:
            d2 = prods[0].properties["startTime"][:10]
            d1 = (dt.date.fromisoformat(d2) - dt.timedelta(days=30)).isoformat()   # window for the USGS check
            meta = write_gunw(r, files[0], scenes, target, d2, d1)
        meta["download_s"], meta["compute_s"] = round(dl, 1), round(time.time() - t0 - dl, 1)
        (OUT / "regions" / r["name"] / "meta.json").write_text(json.dumps(meta, indent=1))
    finally:
        for d in tmps: shutil.rmtree(d, ignore_errors=True)
    state[r["name"]] = scenes
    log(r["name"], "done:", meta["category"], f"({meta['download_s']}s download, {meta['compute_s']}s compute)")

def build_index(errors):
    regs = [json.loads(p.read_text()) for p in sorted((OUT / "regions").glob("*/meta.json"))]
    (OUT / "index.json").write_text(json.dumps({"generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "regions": regs, "errors": errors}, indent=1))

def main():
    a = argparse.ArgumentParser()
    a.add_argument("--region"); a.add_argument("--force", action="store_true")
    a.add_argument("--local", nargs="+"); a.add_argument("--mode", default="gcov")
    a.add_argument("--name"); a.add_argument("--label"); a.add_argument("--lon", type=float, default=0); a.add_argument("--lat", type=float, default=0)
    a.add_argument("--dates", nargs=2)
    a = a.parse_args()
    cfg = json.loads((HERE / "config.json").read_text()); target = cfg.get("target_px", 512)
    OUT.mkdir(parents=True, exist_ok=True); TMP.mkdir(parents=True, exist_ok=True)
    errors = []
    if a.local:                                                  # test with files you downloaded by hand
        r = dict(name=a.name, label=a.label or a.name, lon=a.lon, lat=a.lat, mode=a.mode)
        if a.mode == "gcov": write_gcov(r, a.local[0], a.local[1], [os.path.basename(f) for f in a.local], target)
        else:
            d1, d2 = a.dates or ((dt.date.today() - dt.timedelta(days=30)).isoformat(), dt.date.today().isoformat())
            write_gunw(r, a.local[0], [os.path.basename(a.local[0])], target, d2, d1)
        build_index(errors); return log("wrote", OUT)
    import asf_search as asf
    session = asf.ASFSession().auth_with_token(os.environ["EDL_TOKEN"])
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    for r in cfg["regions"]:
        if a.region and r["name"] != a.region: continue
        try: run_region(r, session, a.force, state, target)
        except Exception as e:
            log(r["name"], "FAILED:", e); errors.append(dict(name=r["name"], error=str(e)[:300]))
        STATE.write_text(json.dumps(state))
    build_index(errors)
    sys.exit(1 if errors and len(errors) == len([r for r in cfg["regions"] if not a.region or r["name"] == a.region]) else 0)

if __name__ == "__main__": main()
