# ALL THREE CHANNELS, one coefficient:
#   netflow_X = sum_t (K/W)[ (1-p_X)(gain_X - loss_X) + p_X * loss_(everyone else) ]
import gzip,json,glob,statistics
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def fit(X,Y):
    k=sum(a*b for a,b in zip(X,Y))/sum(a*a for a in X)
    return k, 1-sum((y-k*x)**2 for x,y in zip(X,Y))/sum(y*y for y in Y)
P={'io':[], 'iot':[], 'y':[], 'c':[]}
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
        IO={};IOT={}
        for t in turns:
            if prevstand:
                W=sum(s['material'] for s in prevstand) or 1
                sh={s['teamID']:s['material']/W for s in prevstand}
                loss={}; gain={}
                for uid in (t['events'].get('deaths') or {}):
                    tm=uid.rsplit('-',1)[0]; loss[tm]=loss.get(tm,0)+prevlen.get(uid,1)
                for s in t['board']['snakes']:
                    d=s['length']-prevlen.get(s['id'],s['length'])
                    if d>0:
                        tm=s['id'].rsplit('-',1)[0]; gain[tm]=gain.get(tm,0)+d
                tot_loss=sum(loss.values())
                for tm,b in s2b.items():
                    own=(1-sh.get(tm,0))*(gain.get(tm,0)-loss.get(tm,0))
                    oth=sh.get(tm,0)*(tot_loss-loss.get(tm,0))
                    IO[b]=IO.get(b,0)+(Kt/W)*own
                    IOT[b]=IOT.get(b,0)+(Kt/W)*(own+oth)
            prevlen={s['id']:s['length'] for s in t['board']['snakes']}
            prevstand=t['standings']
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T in S and M in S:
            P['io'].append(IO.get(T,0)-IO.get(M,0)); P['iot'].append(IOT.get(T,0)-IOT.get(M,0))
            P['y'].append(S[T]-S[M]); P['c'].append(label)
for nm,desc in (('io','inflow+outflow      '),('iot','inflow+outflow+TRANSFER')):
    k,r2=fit(P[nm],P['y'])
    print(f"{desc}  k={k:6.3f}  R^2={r2:.4f}", end="   resid: ")
    for c in ('snake6','snake5-queen','snake5-knight'):
        ys=[y for y,cc in zip(P['y'],P['c']) if cc==c]; xs=[x for x,cc in zip(P[nm],P['c']) if cc==c]
        print(f"{c.split('-')[-1][:6]}={statistics.mean(ys)-k*statistics.mean(xs):+.3f}", end=" ")
    print()
