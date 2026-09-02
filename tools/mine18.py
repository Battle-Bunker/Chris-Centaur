# BASIS v2: outflow = ALL weight leaving an account (deaths AND severs/truncations),
# i.e. every negative per-unit length delta, not only whole-account wipes.
import gzip,json,glob,statistics
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def corr(x,y):
    n=len(x); mx=statistics.mean(x);my=statistics.mean(y)
    sx=statistics.pstdev(x);sy=statistics.pstdev(y)
    if sx==0 or sy==0 or n<3: return float('nan')
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/(n*sx*sy)
def fit(X,Y):
    k=sum(a*b for a,b in zip(X,Y))/sum(a*a for a in X)
    return k,1-sum((y-k*x)**2 for x,y in zip(X,Y))/sum(y*y for y in Y)
D=[]
for batch,label in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight")]:
    for f in sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz")):
        hdr=None;res=None;turns=[]
        try:
            with gzip.open(f,'rt') as fh:
                for line in fh:
                    r=json.loads(line)
                    if r['kind']=='header':hdr=r
                    elif r['kind']=='result':res=r
                    elif r['kind']=='turn':turns.append(r)
        except Exception: pass
        if not(hdr and res and turns): continue
        s2b={s['teamID']:s['bot'] for s in hdr['seats']};K=len(hdr['config']['teams'])
        prevlen={};prevstand=None
        Nv1=defaultdict(float); Nv2=defaultdict(float); sev=defaultdict(float)
        for t in turns:
            cur={s['id']:s['length'] for s in t['board']['snakes']}
            if prevstand:
                W=sum(s['material'] for s in prevstand) or 1
                sh={s['teamID']:s['material']/W for s in prevstand}
                deadloss=defaultdict(float); gain=defaultdict(float); shrink=defaultdict(float)
                dead=set(t['events'].get('deaths') or {})
                for uid in dead: deadloss[uid.rsplit('-',1)[0]]+=prevlen.get(uid,1)
                for uid,pl in prevlen.items():
                    if uid in dead: continue
                    d=cur.get(uid, pl)-pl          # survivors only
                    tm=uid.rsplit('-',1)[0]
                    if d>0: gain[tm]+=d
                    elif d<0: shrink[tm]+=-d        # SEVER / truncation: weight lost, unit alive
                for uid,cells in (t['events'].get('severedCells') or {}).items():
                    sev[s2b.get(uid.rsplit('-',1)[0])]+=len(cells) if isinstance(cells,list) else 0
                tl1=sum(deadloss.values()); tl2=tl1+sum(shrink.values())
                for tm,b in s2b.items():
                    Nv1[b]+=(K/W)*((1-sh.get(tm,0))*(gain[tm]-deadloss[tm])+sh.get(tm,0)*(tl1-deadloss[tm]))
                    Nv2[b]+=(K/W)*((1-sh.get(tm,0))*(gain[tm]-deadloss[tm]-shrink[tm])+sh.get(tm,0)*(tl2-deadloss[tm]-shrink[tm]))
            prevlen=cur; prevstand=t['standings']
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T not in S or M not in S: continue
        D.append(dict(cell=label,x1=Nv1[T]-Nv1[M],x2=Nv2[T]-Nv2[M],y=S[T]-S[M],
                      sev=sev[T]-sev[M],turns=res['turns']))
for nm,key in (("v1  deaths only (last cycle)","x1"),("v2  deaths + severs (fixed)","x2")):
    X=[d[key] for d in D]; Y=[d['y'] for d in D]
    k,r2=fit(X,Y); r=[y-k*x for x,y in zip(X,Y)]
    k1r2=1-sum((y-x)**2 for x,y in zip(X,Y))/sum(y*y for y in Y)
    print(f"\n=== {nm} ===")
    print(f"   fitted k={k:.3f}  R^2={r2:.4f}   |   k=1 identity R^2={k1r2:.4f}")
    print(f"   residual by roster: "+str({c:round(statistics.mean([d['y']-k*d[key] for d in D if d['cell']==c]),3) for c in ('snake6','snake5-queen','snake5-knight')}))
    print(f"   corr(residual, severedCells) = {corr([d['sev'] for d in D], r):+.3f}     corr(residual, turns) = {corr([d['turns'] for d in D], r):+.3f}")
