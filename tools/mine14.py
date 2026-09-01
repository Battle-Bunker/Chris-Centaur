# Does the INFLOW channel fold with the SAME coefficient as outflow?
# inflow = sum of positive per-unit length deltas (a unit that grew, ate).
# outflow = weight destroyed at death.  Both folded by (K/W)(1-p) at the time.
import gzip,json,glob,statistics
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def fit(X,Y):
    k=sum(a*b for a,b in zip(X,Y))/sum(a*a for a in X)
    sst=sum(y*y for y in Y); ssr=sum((y-k*x)**2 for x,y in zip(X,Y))
    return k,1-ssr/sst
ALL={'out':[], 'in':[], 'net':[], 'y':[], 'cell':[]}
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
        s2b={s['teamID']:s['bot'] for s in hdr['seats']}
        Kt=len(hdr['config']['teams'])
        prevlen={};prevstand=None
        OUT={};IN={}
        for t in turns:
            if prevstand:
                W=sum(s['material'] for s in prevstand) or 1
                sh={s['teamID']:s['material']/W for s in prevstand}
                for uid in (t['events'].get('deaths') or {}):
                    team=uid.rsplit('-',1)[0];b=s2b.get(team)
                    OUT[b]=OUT.get(b,0)+(Kt/W)*(1-sh.get(team,0))*prevlen.get(uid,1)
                for s in t['board']['snakes']:
                    d=s['length']-prevlen.get(s['id'],s['length'])
                    if d>0:
                        team=s['id'].rsplit('-',1)[0];b=s2b.get(team)
                        IN[b]=IN.get(b,0)+(Kt/W)*(1-sh.get(team,0))*d
            prevlen={s['id']:s['length'] for s in t['board']['snakes']}
            prevstand=t['standings']
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T in S and M in S:
            o=-(OUT.get(T,0)-OUT.get(M,0)); i=IN.get(T,0)-IN.get(M,0)
            ALL['out'].append(o); ALL['in'].append(i); ALL['net'].append(o+i)
            ALL['y'].append(S[T]-S[M]); ALL['cell'].append(label)
for nm in ('out','in','net'):
    k,r2=fit(ALL[nm],ALL['y'])
    print(f"{nm:5s}  k={k:6.3f}  R^2={r2:.3f}", end='   per-cell resid: ')
    for c in ('snake6','snake5-queen','snake5-knight'):
        ys=[y for y,cc in zip(ALL['y'],ALL['cell']) if cc==c]
        xs=[x for x,cc in zip(ALL[nm],ALL['cell']) if cc==c]
        print(f"{c.split('-')[-1][:6]}={statistics.mean(ys)-k*statistics.mean(xs):+.3f}", end=' ')
    print()
print("\n'net' = folded inflow + folded outflow summed as ONE predictor with ONE k.")
print("If inflow folds the same way, 'net' should beat 'out' alone.")
