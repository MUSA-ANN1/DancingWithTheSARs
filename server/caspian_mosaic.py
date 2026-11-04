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
    signature=[name_of(p) for pair in pairs for p in pair[3:5]]
    rd=out/'regions'/r['name']
    if not force and state.get(r['name'])==signature and (rd/'meta.json').exists(): return log(r['name'],'nothing new, skipped')
    width=max(512,int(target*(east-west)/(north-south))); height=int(target); shape=(height,width)
    dst_transform=from_origin(west,north,(east-west)/width,(north-south)/height)
    # Blend overlapping granules instead of exposing hard tile boundaries.
    # Each scene is robustly radiometrically aligned to the existing mosaic in
    # its overlap, then feather-weighted so scene edges do not form visible seams.
    sums=[np.zeros(shape,np.float64),np.zeros(shape,np.float64)]
    weights=[np.zeros(shape,np.float32),np.zeros(shape,np.float32)]
    from scipy.ndimage import distance_transform_edt
    scenes=[]; dates_seen=[]; started_at=time.monotonic()
    try:
        for d0,d1,key,p0,p1 in pairs:
            dates_seen.extend([d0,d1]); scenes.extend([name_of(p0),name_of(p1)])
            for idx,product in enumerate((p0,p1)):
                folder=Path(tempfile.mkdtemp(dir=tmp))
                try:
                    product.download(path=str(folder),session=session)
                    found=list(folder.glob('*.h5'))
                    if not found: raise RuntimeError('Downloaded granule missing HDF5: '+str(name_of(product)))
                    p=L.load(found[0],'gcov',target=target,pols=('HHHH','HVHV'))
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
                        # Correct scene-to-scene radiometric offsets only where
                        # both scenes observe the same ground; reject extreme fits.
                        offset = float(np.median(existing[overlap_mask] - tile[overlap_mask]))
                        offset = float(np.clip(offset, -8.0, 8.0))
                    else:
                        offset = 0.0
                    adjusted = tile.astype(np.float32, copy=False) + offset
                    # Distance-to-edge feathering suppresses sharp tile outlines.
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
        # Build the Caspian water reference from Natural Earth land polygons.
        # Natural Earth's lakes layer does not reliably include the Caspian Sea;
        # the land layer traces its shoreline as the boundary between land and water.
        import io, zipfile, requests, shapefile
        from scipy.ndimage import binary_erosion, distance_transform_edt
        ne_url = 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip'
        cache = tmp / 'ne_10m_land.zip'
        if not cache.exists():
            response = requests.get(ne_url, timeout=90)
            response.raise_for_status()
            cache.write_bytes(response.content)
        with zipfile.ZipFile(cache) as zf:
            shp_name = next(n for n in zf.namelist() if n.lower().endswith('.shp'))
            stem = shp_name[:-4]
            def read_member(ext):
                return io.BytesIO(zf.read(stem + ext))
            sf = shapefile.Reader(shp=read_member('.shp'), shx=read_member('.shx'), dbf=read_member('.dbf'))

            land_mask_img = Image.new('1', (width, height), 0)
            land_draw = ImageDraw.Draw(land_mask_img)
            def project_ring(points):
                return [
                    (max(0, min(width - 1, (lon - west) / (east - west) * (width - 1))),
                     max(0, min(height - 1, (north - lat) / (north - south) * (height - 1))))
                    for lon, lat in points
                ]
            for feature in sf.iterShapes():
                pts = feature.points
                parts = list(feature.parts) + [len(pts)]
                for i in range(len(parts) - 1):
                    ring = pts[parts[i]:parts[i + 1]]
                    if len(ring) >= 3:
                        land_draw.polygon(project_ring(ring), fill=1)

            # The configured processing extent is the Caspian basin. Inverting
            # land therefore isolates its water surface without depending on a
            # missing/renamed Caspian lake record.
            land_mask = np.asarray(land_mask_img, dtype=bool)
            reference_water = ~land_mask
            if int(reference_water.sum()) < 1000:
                raise RuntimeError('Natural Earth land polygons produced an implausibly small Caspian water mask.')

            # Draw only the reference-water boundary for map context.
            edge = reference_water ^ binary_erosion(reference_water, iterations=1)
            outline = Image.new('RGBA', (width, height), (0, 0, 0, 0))
            outline_pixels = np.zeros((height, width, 4), dtype=np.uint8)
            outline_pixels[edge] = (105, 205, 230, 255)
            outline = Image.fromarray(outline_pixels, 'RGBA')

        # Define a 15-pixel coastal search band around the reference shoreline.
        # At this basin-wide grid resolution, this is a screening band, not a precise
        # geodetic buffer. The reference polygon is not treated as observed water.
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

        # Darker backscatter is treated as likely water. This is exploratory, so
        # require threshold margin and a meaningful temporal difference.
        water_before = (before < threshold_before) & np.isfinite(before)
        water_after = (after < threshold_after) & np.isfinite(after)
        margin_db = 2.0
        change_db = 3.0
        # Keep the published change layer on the Caspian-water side only:
        # land pixels remain transparent, even inside the coastal screening band.
        confident = (common & coastal_zone & reference_water &
                     (np.abs(before - threshold_before) >= margin_db) &
                     (np.abs(after - threshold_after) >= margin_db) &
                     (np.abs(after - before) >= change_db))
        retreat = water_before & ~water_after & confident
        advance = ~water_before & water_after & confident

        # Separate water-classification layers, shoreline-change candidates,
        # and actual NISAR observation coverage. No-data remains transparent.
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

        # Coverage colors: common observations in both dates, single-date coverage
        # separately. Transparent pixels have no usable observation on either date.
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
        evidence=['Mosaic assembled from matching repeat NISAR track/direction/frame pairs. Overlapping scenes are median-offset aligned and edge-feather blended to reduce tile seams.','The change layer is masked to the Natural Earth Caspian-water polygon; land pixels are transparent.','Shoreline-change candidates are restricted to a 15-pixel band around the Natural Earth reference shoreline.','Candidate pixels require a 2 dB margin from both date-specific thresholds and at least 3 dB temporal backscatter difference.','Water classification is exploratory; wind, waves, vegetation, soil moisture and radar geometry can mimic shoreline change.','coverage.png shows valid NISAR observation availability, not the shoreline. reference.png is Natural Earth reference geography, not an observation.',f'Processed {len(pairs)} frame pairs; tile dates range from {min(dates_seen)} to {max(dates_seen)}.']
        meta=finish(r,{'type':'mosaic','mode':'shore','before':min(dates_seen),'after':max(dates_seen),'bbox':bbox,'size':[width,height],'pol':'HHHH preferred; HVHV fallback','unit':'dB','range':list(DB_RANGE),'threshold':[round(threshold_before,1),round(threshold_after,1)],'stats':stats,'category':'Coastal-zone shoreline-change screening','confidence':'exploratory; threshold and temporal-difference filters applied','evidence':evidence,'scenes':scenes,'frame_pairs':len(pairs),'images':{'before':'before.png','after':'after.png','water_before':'water_before.png','water_after':'water_after.png','change':'change.png','coverage':'coverage.png','reference':'reference.png'}},rd)
        meta['elapsed_s']=round(time.monotonic()-started_at,1); (rd/'meta.json').write_text(json.dumps(meta,indent=1)); state[r['name']]=signature; log(r['name'],'mosaic complete',stats)
    finally:
        pass
