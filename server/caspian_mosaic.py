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
    sums=[np.zeros(shape,np.float32),np.zeros(shape,np.float32)]; counts=[np.zeros(shape,np.uint16),np.zeros(shape,np.uint16)]
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
                    valid=np.isfinite(tile); sums[idx]+=np.where(valid,tile,0); counts[idx]+=valid.astype(np.uint16)
                finally:

                    shutil.rmtree(folder,ignore_errors=True)
        before=np.divide(sums[0],counts[0],out=np.full(shape,np.nan,np.float32),where=counts[0]>0)
        after=np.divide(sums[1],counts[1],out=np.full(shape,np.nan,np.float32),where=counts[1]>0)
        common=np.isfinite(before)&np.isfinite(after); n=int(common.sum())
        if n<1000: raise RuntimeError(f'Only {n} common pixels across Caspian mosaic; refusing misleading comparison.')
        threshold_before=L.otsu(before[common]); threshold_after=L.otsu(after[common])
        if threshold_before is None or threshold_after is None: raise RuntimeError('Insufficient common pixels for shoreline classification.')
        w0=(before<threshold_before)&common; w1=(after<threshold_after)&common; retreat=w0&~w1; advance=~w0&w1&common
        stats={'common_coverage_pct':round(100*n/before.size,2),'before_coverage_pct':round(100*int(np.isfinite(before).sum())/before.size,2),'after_coverage_pct':round(100*int(np.isfinite(after).sum())/after.size,2),'water_before_pct_of_common':round(100*int(w0.sum())/n,2),'water_after_pct_of_common':round(100*int(w1.sum())/n,2),'retreat_pct_of_common':round(100*int(retreat.sum())/n,3),'advance_pct_of_common':round(100*int(advance.sum())/n,3),'threshold_db':[round(threshold_before,1),round(threshold_after,1)]}
        rd.mkdir(parents=True,exist_ok=True); L.quant_png(before,*DB_RANGE,rd/'before.png'); L.quant_png(after,*DB_RANGE,rd/'after.png'); L.overlay_png(retreat,advance,rd/'change.png')

        shore=[(47.0,48.0),(49.4,47.2),(51.8,46.8),(53.5,45.8),(53.9,44.2),(53.2,42.5),(52.8,40.7),(52.1,39.0),(51.5,37.8),(50.1,36.7),(49.0,37.2),(48.5,38.6),(48.0,40.0),(47.3,41.2),(46.7,42.8),(47.0,44.2),(48.0,45.4),(48.2,46.6)]
        outline=Image.new('RGBA',(width,height),(0,0,0,0)); draw=ImageDraw.Draw(outline)
        xy=[((lon-west)/(east-west)*(width-1),(north-lat)/(north-south)*(height-1)) for lon,lat in shore]
        draw.polygon(xy,fill=(14,67,110,220),outline=(105,205,230,255),width=2)
        pix=np.asarray(outline).copy()

        sea_mask=Image.new('1',(width,height),0); ImageDraw.Draw(sea_mask).polygon(xy,fill=1)
        sm=np.asarray(sea_mask,dtype=bool); covered=sm&common
        pix[covered]=[205,220,225,255]
        Image.fromarray(pix,'RGBA').save(rd/'coverage.png',optimize=True)
        evidence=['Mosaic assembled from matching repeat NISAR track/direction/frame pairs.','Transparent pixels are unobserved; changes are calculated only where both dates have valid pixels.','Automatic backscatter threshold is exploratory; wind, waves and radar geometry can mimic shoreline change.',f'Processed {len(pairs)} frame pairs; tile dates range from {min(dates_seen)} to {max(dates_seen)}.']
        meta=finish(r,{'type':'mosaic','mode':'shore','before':min(dates_seen),'after':max(dates_seen),'bbox':bbox,'size':[width,height],'pol':'HHHH preferred; HVHV fallback','unit':'dB','range':list(DB_RANGE),'threshold':[round(threshold_before,1),round(threshold_after,1)],'stats':stats,'category':'Basin-wide shoreline-change screening','confidence':'exploratory radar-only','evidence':evidence,'scenes':scenes,'frame_pairs':len(pairs),'images':{'before':'before.png','after':'after.png','change':'change.png','coverage':'coverage.png'}},rd)
        meta['elapsed_s']=round(time.monotonic()-started_at,1); (rd/'meta.json').write_text(json.dumps(meta,indent=1)); state[r['name']]=signature; log(r['name'],'mosaic complete',stats)
    finally:
        pass
