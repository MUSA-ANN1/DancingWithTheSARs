import datetime as dt, json, tempfile, shutil, time
from collections import defaultdict
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import nisar_lib as L

DB_RANGE=(-30.0,0.0)

def name_of(p): return p.properties.get('sceneName') or p.properties.get('fileID')

def run(r, session, state, force, target, cfg, out, tmp, finish, log):
    import asf_search as asf
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import reproject, Resampling
    bbox=cfg.get('caspian_bbox',[46.5,36.4,55.0,47.5]); west,south,east,north=bbox
    wkt=f'POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},{west} {south}))'
    end=dt.date.today()+dt.timedelta(days=1); start=end-dt.timedelta(days=r.get('days',365))
    products=list(asf.search(dataset='NISAR',processingLevel='GCOV',intersectsWith=wkt,start=start.isoformat(),end=end.isoformat(),maxResults=1000))
    groups=defaultdict(dict)
    for p in products:
        try:
            q=L.parse_name(name_of(p)); groups[(q['track'],q['dir'],q['frame'])][q['date']]=p
        except Exception: pass
    pairs=[]
    for key, dates in groups.items():
        ds=sorted(dates)
        if len(ds)>=2: pairs.append((ds[-2],ds[-1],key,dates[ds[-2]],dates[ds[-1]]))
    pairs.sort(key=lambda x:(x[1],x[0]),reverse=True); pairs=pairs[:int(cfg.get('max_frame_pairs',10))]
    if not pairs: raise RuntimeError('No repeat GCOV frame pairs found over the Caspian polygon.')
    max_span = int(cfg.get('max_composite_span_days', 7))
    before_dates = sorted({p[0] for p in pairs})
    after_dates = sorted({p[1] for p in pairs})
    before_span = (dt.date.fromisoformat(before_dates[-1]) - dt.date.fromisoformat(before_dates[0])).days
    after_span = (dt.date.fromisoformat(after_dates[-1]) - dt.date.fromisoformat(after_dates[0])).days
    if before_span > max_span or after_span > max_span:
        raise RuntimeError(
            f'Composite date spread exceeds {max_span} days: '
            f'before={before_dates[0]}..{before_dates[-1]}, after={after_dates[0]}..{after_dates[-1]}'
        )
    signature=[name_of(p) for pair in pairs for p in pair[3:5]]
    rd=out/'regions'/r['name']
    if not force and state.get(r['name'])==signature and (rd/'meta.json').exists(): return log(r['name'],'nothing new, skipped')
    width=max(512,int(target*(east-west)/(north-south))); height=int(target); shape=(height,width)
    dst_transform=from_origin(west,north,(east-west)/width,(north-south)/height)
    sums=[np.zeros(shape,np.float64),np.zeros(shape,np.float64)]
    weights=[np.zeros(shape,np.float32),np.zeros(shape,np.float32)]
    from scipy.ndimage import distance_transform_edt
    scenes=[]; dates_seen=[]; frame_pair_dates=[]; quality_masked_scenes=[]; input_audits=[]; reference_pol=None; started_at=time.monotonic()
    try:
        for d0,d1,key,p0,p1 in pairs:
            dates_seen.extend([d0,d1]); scenes.extend([name_of(p0),name_of(p1)])
            frame_pair_dates.append({'before': d0, 'after': d1, 'track': key[0], 'direction': key[1], 'frame': key[2]})
            for idx,product in enumerate((p0,p1)):
                folder=Path(tempfile.mkdtemp(dir=tmp))
                try:
                    product.download(path=str(folder),session=session)
                    found=list(folder.glob('*.h5'))
                    if not found: raise RuntimeError('Downloaded granule missing HDF5: '+str(name_of(product)))
                    requested_pols=(reference_pol,) if reference_pol else ('HHHH','HVHV')
                    p=L.load(found[0],'gcov',target=target,pols=requested_pols,require_mask=True)
                    if reference_pol is None:
                        reference_pol=p['pol']
                    elif p['pol'] != reference_pol:
                        raise RuntimeError(f'Inconsistent polarization in mosaic: expected {reference_pol}, got {p["pol"]} in {name_of(product)}')
                    if not p['quality_mask_used']:
                        raise RuntimeError(f'Quality mask was not applied to {name_of(product)}')
                    quality_masked_scenes.append(name_of(product))
                    input_audits.append({'scene': name_of(product), 'polarization': p['pol'], 'quality_mask_used': True})
                    db=np.full(p['a'].shape,np.nan,np.float32); good=np.isfinite(p['a'])&(p['a']>0); db[good]=10*np.log10(p['a'][good])
                    if len(p['x'])<2 or len(p['y'])<2: continue
                    dx=float(np.median(np.diff(p['x']))); dy=float(np.median(np.diff(p['y'])))
                    src_transform=rasterio.Affine(dx,0,float(p['x'][0])-dx/2,0,dy,float(p['y'][0])-dy/2)
                    tile=np.full(shape,np.nan,np.float32)
                    reproject(source=db,destination=tile,src_transform=src_transform,src_crs=f"EPSG:{p['epsg']}",src_nodata=np.nan,dst_transform=dst_transform,dst_crs='EPSG:4326',dst_nodata=np.nan,resampling=Resampling.bilinear)
                    valid=np.isfinite(tile)
                    if not valid.any():
                        continue
                    existing_valid = weights[idx] > 0
                    overlap_mask = valid & existing_valid
                    if int(overlap_mask.sum()) >= 100:
                        existing = np.divide(
                            sums[idx], weights[idx],
                            out=np.zeros(shape, np.float64),
                            where=existing_valid
                        )
                        offset = float(np.median(existing[overlap_mask] - tile[overlap_mask]))
                        offset = float(np.clip(offset, -8.0, 8.0))
                    else:
                        offset = 0.0
                    adjusted = tile.astype(np.float32, copy=False) + offset
                    edge_distance = distance_transform_edt(valid)
                    feather = np.clip(edge_distance / 32.0, 0.05, 1.0).astype(np.float32)
                    sums[idx] += np.where(valid, adjusted * feather, 0.0)
                    weights[idx] += feather

                finally:

                    shutil.rmtree(folder,ignore_errors=True)
        before=np.divide(sums[0],weights[0],out=np.full(shape,np.nan,np.float32),where=weights[0]>0)
        after=np.divide(sums[1],weights[1],out=np.full(shape,np.nan,np.float32),where=weights[1]>0)
        common=np.isfinite(before)&np.isfinite(after); n=int(common.sum())
        if n<1000: raise RuntimeError(f'Only {n} common pixels across Caspian mosaic; refusing misleading comparison.')
        import io, zipfile, requests, shapefile
        from shapely.geometry import shape as shapely_shape, box
        from shapely import make_valid
        from rasterio.features import rasterize
        from scipy.ndimage import binary_erosion, distance_transform_edt
        ne_url = 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip'
        cache = tmp / 'ne_10m_land.zip'
        if not cache.exists():
            response = requests.get(ne_url, timeout=90)
            response.raise_for_status()
            cache.write_bytes(response.content)

        extent = box(west, south, east, north)
        land_geometries = []
        with zipfile.ZipFile(cache) as zf:
            shp_name = next(n for n in zf.namelist() if n.lower().endswith('.shp'))
            stem = shp_name[:-4]
            def read_member(ext):
                return io.BytesIO(zf.read(stem + ext))
            sf = shapefile.Reader(shp=read_member('.shp'), shx=read_member('.shx'), dbf=read_member('.dbf'))
            for feature in sf.iterShapes():
                try:
                    geom = shapely_shape(feature.__geo_interface__)
                    if not geom.is_valid:
                        geom = make_valid(geom)
                    if not geom.is_empty and geom.intersects(extent):
                        clipped = geom.intersection(extent)
                        if not clipped.is_empty:
                            land_geometries.append((clipped, 1))
                except Exception:
                    continue

        if not land_geometries:
            raise RuntimeError('Natural Earth land polygons did not intersect the configured Caspian extent.')

        land_mask = rasterize(
            land_geometries,
            out_shape=shape,
            transform=dst_transform,
            fill=0,
            all_touched=False,
            dtype='uint8'
        ).astype(bool)

        reference_water = ~land_mask
        water_pixels = int(reference_water.sum())
        if water_pixels < 1000 or water_pixels > int(reference_water.size * 0.90):
            raise RuntimeError(
                f'Natural Earth Caspian water mask failed sanity check: '
                f'{water_pixels}/{reference_water.size} water pixels.'
            )

        edge = reference_water ^ binary_erosion(reference_water, iterations=1)
        outline_pixels = np.zeros((height, width, 4), dtype=np.uint8)
        outline_pixels[edge] = (105, 205, 230, 255)
        outline = Image.fromarray(outline_pixels, 'RGBA')

        interior = binary_erosion(reference_water, iterations=1)
        shoreline_edge = reference_water ^ interior
        distance_px = distance_transform_edt(~shoreline_edge)
        coastal_zone = distance_px <= 15.0
        coast_common = common & coastal_zone
        if int(coast_common.sum()) < 100:
            raise RuntimeError('Too few common NISAR pixels inside the reference coastal zone.')

        threshold_before = L.otsu(before[coast_common])
        threshold_after = L.otsu(after[coast_common])
        if threshold_before is None or threshold_after is None:
            raise RuntimeError('Insufficient coastal-zone backscatter samples for water classification.')

        water_before = (before < threshold_before) & np.isfinite(before)
        water_after = (after < threshold_after) & np.isfinite(after)
        margin_db = 2.0
        change_db = 3.0
        confident = (common & coastal_zone & reference_water &
                     (np.abs(before - threshold_before) >= margin_db) &
                     (np.abs(after - threshold_after) >= margin_db) &
                     (np.abs(after - before) >= change_db))
        retreat = water_before & ~water_after & confident
        advance = ~water_before & water_after & confident

        def mask_png(mask, path, rgba):
            rgba_img = np.zeros(mask.shape + (4,), dtype=np.uint8)
            rgba_img[mask] = rgba
            Image.fromarray(rgba_img, 'RGBA').save(path, optimize=True)
        rd.mkdir(parents=True, exist_ok=True)
        L.quant_png(before, *DB_RANGE, rd/'before.png')
        L.quant_png(after, *DB_RANGE, rd/'after.png')
        mask_png(water_before, rd/'water_before.png', (20, 125, 220, 210))
        mask_png(water_after, rd/'water_after.png', (20, 125, 220, 210))
        L.overlay_png(retreat, advance, rd/'change.png')

        cov = np.zeros((height, width, 4), dtype=np.uint8)
        only_before = np.isfinite(before) & ~np.isfinite(after)
        only_after = np.isfinite(after) & ~np.isfinite(before)
        cov[common] = [205, 220, 225, 255]
        cov[only_before] = [245, 174, 66, 255]
        cov[only_after] = [83, 153, 235, 255]
        Image.fromarray(cov, 'RGBA').save(rd/'coverage.png', optimize=True)
        outline.save(rd/'reference.png', optimize=True)

        ncoast = int(coast_common.sum())
        nconf = int(confident.sum())
        stats = {
            'common_coverage_pct': round(100*n/before.size, 2),
            'before_coverage_pct': round(100*int(np.isfinite(before).sum())/before.size, 2),
            'after_coverage_pct': round(100*int(np.isfinite(after).sum())/after.size, 2),
            'coastal_zone_common_pixels': ncoast,
            'coastal_zone_coverage_pct_of_grid': round(100*ncoast/before.size, 2),
            'confident_coastal_pixels': nconf,
            'retreat_candidate_pixels': int(retreat.sum()),
            'advance_candidate_pixels': int(advance.sum()),
            'retreat_pct_of_confident_coastal': round(100*int(retreat.sum())/max(1,nconf), 3),
            'advance_pct_of_confident_coastal': round(100*int(advance.sum())/max(1,nconf), 3),
            'threshold_db': [round(threshold_before, 1), round(threshold_after, 1)],
            'confidence_rules': {'threshold_margin_db': margin_db, 'minimum_temporal_difference_db': change_db,
                                 'coastal_band_pixels': 15}
        }
        evidence=['Mosaic assembled from matching repeat NISAR track/direction/frame pairs. Overlapping scenes are median-offset aligned and edge-feather blended to reduce tile seams.','The change layer is masked to the Natural Earth Caspian-water polygon; land pixels are transparent.','Shoreline-change candidates are restricted to a 15-pixel band around the Natural Earth reference shoreline.','Candidate pixels require a 2 dB margin from both date-specific thresholds and at least 3 dB temporal backscatter difference.','All contributing scenes use one consistent polarization (HHHH preferred, otherwise HVHV) and require the GCOV mask; mask values 0 and 255 are excluded before downsampling.' ,'Water classification is exploratory; wind, waves, vegetation, soil moisture and radar geometry can mimic shoreline change.','coverage.png shows valid NISAR observation availability, not the shoreline. reference.png is Natural Earth reference geography, not an observation.',f'Processed {len(pairs)} frame pairs; tile dates range from {min(dates_seen)} to {max(dates_seen)}.']
        meta=finish(r,{'type':'mosaic','mode':'shore','before':min(dates_seen),'after':max(dates_seen),'bbox':bbox,'size':[width,height],'pol':reference_pol,'quality_mask':'Applied before downsampling; mask values 1..254 valid, 0 and 255 excluded','quality_masked_scene_count':len(quality_masked_scenes),'frame_pair_dates':frame_pair_dates,'unit':'dB','range':list(DB_RANGE),'threshold':[round(threshold_before,1),round(threshold_after,1)],'stats':stats,'category':'Coastal-zone shoreline-change screening','confidence':'exploratory; threshold and temporal-difference filters applied','evidence':evidence,'scenes':scenes,'frame_pairs':len(pairs),'before_date_window':[before_dates[0],before_dates[-1]],'after_date_window':[after_dates[0],after_dates[-1]],'max_composite_span_days':max_span,'input_audits':input_audits,'images':{'before':'before.png','after':'after.png','water_before':'water_before.png','water_after':'water_after.png','change':'change.png','coverage':'coverage.png','reference':'reference.png'}},rd)
        meta['elapsed_s']=round(time.monotonic()-started_at,1); (rd/'meta.json').write_text(json.dumps(meta,indent=1)); state[r['name']]=signature; log(r['name'],'mosaic complete',stats)
    finally:
        pass
