# Pooled regression: sharePar(T-M) ~ k * predictor(T-M), one k for all cells.
# Compare R^2 and per-cell residuals for three nested predictors.
import gzip,json,glob,statistics,math
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
DATA=defaultdict(list)
for batch,label in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight")]:
    for f in sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz")):
        hdr=None;result=None;turns=[]
        try:
            with gzip.open(f,'rt') as fh:
                for line in fh:
                    r=json.loads(line)
                    if r['kind']=='header':hdr=r
                    elif r['kind']=='result':result=r
                    elif r['kind']=='turn':turns.append(r)
        except Exception: pass
        if not(hdr and result and turns): continue
        s2b={s['teamID']:s['bot'] for s in hdr['seats']}
        K=len(hdr['config']['teams'])
        prevlen={};prevstand=None
        C=defaultdict(float);R=defaultdict(float);F=defaultdict(float)
        for t in turns:
            for uid in (t['events'].get('deaths') or {}):
                team=uid.rsplit('-',1)[0];b=s2b.get(team);w=prevlen.get(uid,1)
                C[b]+=1;R[b]+=w
                if prevstand:
                    W=sum(s['material'] for s in prevstand) or 1
                    mine=next((s['material'] for s in prevstand if s['teamID']==team),0)
                    F[b]+=(K/W)*(1-mine/W)*w
            prevlen={s['id']:s['length'] for s in t['board']['snakes']}
            prevstand=t['standings']
        S={p['bot']:p['sharePar'] for p in result['placements']}
        T,M='lobster-territory','lobster-material'
        if T in S and M in S:
            DATA[label].append((S[T]-S[M], -(C[T]-C[M]), -(R[T]-R[M]), -(F[T]-F[M])))
names=['deaths avoided','weight saved','FOLDED weight (K/W)(1-p)']
for j,nm in enumerate(names):
    xs=[];ys=[]
    for l,rows in DATA.items():
        for y,*x in rows: xs.append(x[j]); ys.append(y)
    k=sum(a*b for a,b in zip(xs,ys))/sum(a*a for a in xs)   # through-origin slope
    ss_tot=sum(y*y for y in ys); ss_res=sum((y-k*x)**2 for x,y in zip(xs,ys))
    print(f"\n{nm}:  pooled k = {k:.4f}   R^2(through origin) = {1-ss_res/ss_tot:.3f}")
    for l,rows in DATA.items():
        my=statistics.mean(r[0] for r in rows); mx=statistics.mean(r[1+j] for r in rows)
        print(f"    {l:16s} observed {my:+.3f}   model {k*mx:+.3f}   residual {my-k*mx:+.3f}")
