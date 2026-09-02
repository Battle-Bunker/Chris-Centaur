"""Population extraction: one row per (game, seat) with sharePar.

CONSERVATION ASSERTED INSIDE THE EXTRACTION (standing rule): sharePar = K * w/W and
shares sum to 1, so per game the seat sharePars must sum to K. Games violating this
are counted and excluded, never silently kept.
"""
import gzip,json,glob,os,sys,csv
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
OUT=f"{SP}/archx-value/tools/population.csv"
rows=[];bad=0;good=0;noresult=0
for f in glob.glob(f"{SP}/**/arms/*/*/*.jsonl.gz",recursive=True):
    parts=f.split('/arms/'); batch=os.path.basename(parts[0]); arm=parts[1].split('/')[0]
    hdr=res=None
    try:
        with gzip.open(f,'rt') as fh:
            for line in fh:
                if line.startswith('{"kind":"header"'): hdr=json.loads(line)
                elif line.startswith('{"kind":"result"'): res=json.loads(line); break
    except Exception: continue
    if not(hdr and res): noresult+=1; continue
    cfg=hdr['config']; K=len(cfg['teams'])
    ps=res['placements']
    if all('sharePar' in p for p in ps):
        src='native'
        tot=sum(p['sharePar'] for p in ps)
        # CONSERVATION: shares sum to 1, so sharePars sum to K. Real check on native rows.
        if abs(tot-K)>0.01: bad+=1; continue
    else:
        # Older schema (pre-sharePar). Derive it; conservation is then vacuous by
        # construction, so these rows are stamped and must not be pooled naively.
        src='derived'
        W=sum(p.get('adjudicatedMaterial', p.get('finalMaterial',0)) for p in ps)
        if W<=0: bad+=1; continue
        for p in ps:
            p['sharePar']=K*p.get('adjudicatedMaterial',p.get('finalMaterial',0))/W
    good+=1
    gid=f"{batch}|{cfg['name']}|{cfg.get('seed')}|{os.path.basename(f)}"
    for p in ps:
        rows.append(dict(batch=batch,arm=arm,cell=cfg['name'],seed=cfg.get('seed'),
                         game=gid,bot=p['bot'],sharePar=p['sharePar'],
                         src=src,K=K,size=cfg.get('size'),turnCap=cfg.get('turnCap'),
                         budgetMs=cfg.get('budgetMs'),roster="|".join(cfg.get('roster',[]))))
with open(OUT,'w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
from collections import Counter
c=Counter(r['src'] for r in rows)
print(f"games kept {good}, CONSERVATION FAILURES dropped {bad}, no-result/unreadable {noresult}")
print(f"  sharePar provenance: native rows {c['native']}, derived-from-material rows {c['derived']}")
print(f"rows {len(rows)} -> {OUT}")
