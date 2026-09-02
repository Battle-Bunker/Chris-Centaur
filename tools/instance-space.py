"""ITEM 2 - INSTANCE-SPACE COVERAGE: what are our verdicts actually quantified over?

Ruling 49's second half. Features every cell, states the coverage, and names the gaps.
Features are configuration properties (known before play) plus two cheap induced ones.
"""
import csv,gzip,json,glob,statistics
from collections import defaultdict,Counter
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"

def cell_features():
    feats={}
    seen=set()
    for f in glob.glob(f"{SP}/**/arms/*/*/*.jsonl.gz",recursive=True):
        try:
            with gzip.open(f,'rt') as fh: h=json.loads(fh.readline())
        except Exception: continue
        if h.get('kind')!='header': continue
        c=h['config']; nm=c['name']
        if nm in seen: continue
        seen.add(nm)
        ros=c.get('roster',[])
        pieces=[k for k in ros if k!='snake']
        feats[nm]=dict(
            size=c.get('size'), teams=len(c.get('teams',[])), units=len(ros),
            pieces=len(pieces), piece_frac=len(pieces)/len(ros) if ros else 0,
            has_king=int('king' in ros), has_slider=int(any(k in ('queen','rook','bishop') for k in ros)),
            has_leaper=int('knight' in ros),
            turnCap=c.get('turnCap'), budgetMs=c.get('budgetMs'),
            foodRate=(c.get('food') or {}).get('spawnRate'),
            potions=int(bool((c.get('potions') or {}).get('enabled'))),
            potionRate=(c.get('potions') or {}).get('spawnRate') or 0,
            hazardDmg=(c.get('hazards') or {}).get('damageRatio') or 0,
            hazardCount=(c.get('hazards') or {}).get('count') or 0,
            density=len(ros)*len(c.get('teams',[]))/(c.get('size',1)**2),
        )
    return feats

if __name__=='__main__':
    F=cell_features()
    games=Counter()
    for r in csv.DictReader(open(f"{SP}/archx-value/tools/population.csv")): games[r['cell']]+=1
    for c in games: games[c]//=3
    F={k:v for k,v in F.items() if k in games}
    print(f"INSTANCE SPACE: {len(F)} cells, {sum(games[c] for c in F)} games\n")
    keys=['size','teams','units','pieces','piece_frac','turnCap','budgetMs','foodRate',
          'potionRate','hazardDmg','density']
    print(f"{'feature':12s} {'distinct':>9s} {'min':>8s} {'max':>8s}   value: cells (games)")
    for k in keys:
        vals=Counter(F[c][k] for c in F)
        wg=Counter()
        for c in F: wg[F[c][k]]+=games[c]
        vs=sorted(v for v in vals if v is not None)
        top=", ".join(f"{v}: {vals[v]}c({wg[v]}g)" for v in vs[:6])
        print(f"{k:12s} {len(vals):9d} {str(vs[0]):>8s} {str(vs[-1]):>8s}   {top}")
    print("\nPIECE FRACTION - the axis along which POP-3's cycle reverses sign:")
    byp=defaultdict(lambda:[0,0])
    for c in F:
        byp[F[c]['pieces']][0]+=1; byp[F[c]['pieces']][1]+=games[c]
    for p in sorted(byp): print(f"   {p} pieces of 6: {byp[p][0]:2d} cells, {byp[p][1]:5d} games")
    print("\nCOVERAGE GAPS (a verdict cannot be quantified over a value never run):")
    gaps=[]
    if len({F[c]['teams'] for c in F})==1: gaps.append(f"team count: only {list({F[c]['teams'] for c in F})[0]} ever run")
    bs=sorted({F[c]['budgetMs'] for c in F if F[c]['budgetMs']})
    gaps.append(f"budgetMs values: {bs}")
    ss=sorted({F[c]['size'] for c in F if F[c]['size']})
    gaps.append(f"board sizes: {ss}")
    tc=sorted({F[c]['turnCap'] for c in F if F[c]['turnCap']})
    gaps.append(f"turnCap values: {tc}")
    pf=sorted({F[c]['pieces'] for c in F})
    gaps.append(f"piece counts present: {pf}  (3 and 5 of 6 NEVER RUN)")
    for g in gaps: print("   - "+g)
