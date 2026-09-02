# BASIS TEST, CLOCK-CORRECTED.  Single clock: the BOARD.
# events[t] resolve board[t] -> board[t+1].  W, p, gains, losses all read off board.
import gzip,json,glob,statistics
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def corr(x,y):
    n=len(x);mx=statistics.mean(x);my=statistics.mean(y)
    sx=statistics.pstdev(x);sy=statistics.pstdev(y)
    if sx==0 or sy==0 or n<3: return float('nan')
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/(n*sx*sy)
def fit(X,Y):
    k=sum(a*b for a,b in zip(X,Y))/sum(a*a for a in X)
    return k,1-sum((y-k*x)**2 for x,y in zip(X,Y))/sum(y*y for y in Y)
D=[]
unattr=0.0; moved=0.0
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
        A=defaultdict(float); B=defaultdict(float); sev=defaultdict(float)
        for i in range(len(turns)-1):
            L0={s['id']:s['length'] for s in turns[i]['board']['snakes']}
            L1={s['id']:s['length'] for s in turns[i+1]['board']['snakes']}
            ev=turns[i]['events']
            w0=defaultdict(float)
            for uid,l in L0.items(): w0[uid.rsplit('-',1)[0]]+=l
            W0=sum(w0.values()) or 1
            gain=defaultdict(float); lossD=defaultdict(float); lossS=defaultdict(float)
            for uid,l0 in L0.items():
                tm=uid.rsplit('-',1)[0]
                if uid not in L1: lossD[tm]+=l0          # died: whole account
                else:
                    d=L1[uid]-l0
                    if d>0: gain[tm]+=d
                    elif d<0: lossS[tm]+=-d               # sever/truncation
            for uid,cells in (ev.get('severedCells') or {}).items():
                sev[s2b.get(uid.rsplit('-',1)[0])]+=len(cells) if isinstance(cells,list) else 0
            # attribution audit on this clock
            for tm in w0:
                w1=sum(l for uid,l in L1.items() if uid.rsplit('-',1)[0]==tm)
                unattr+=abs((w1-w0[tm])-(gain[tm]-lossD[tm]-lossS[tm])); moved+=abs(w1-w0[tm])
            tlD=sum(lossD.values()); tlAll=tlD+sum(lossS.values())
            for tm,b in s2b.items():
                p=w0[tm]/W0
                # A = deaths only (cycle-3 basis) ; B = deaths + severs (cycle-4 basis)
                A[b]+=(K/W0)*((1-p)*(gain[tm]-lossD[tm]) + p*(tlD-lossD[tm]))
                B[b]+=(K/W0)*((1-p)*(gain[tm]-lossD[tm]-lossS[tm]) + p*(tlAll-lossD[tm]-lossS[tm]))
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T not in S or M not in S: continue
        D.append(dict(cell=label,a=A[T]-A[M],b=B[T]-B[M],y=S[T]-S[M],sev=sev[T]-sev[M],turns=res['turns']))
print(f"attribution gap on ONE clock: {100*unattr/moved:.2f}% of weight moved  (was 54-88% when clocks were mixed)\n")
for nm,key in (("A  deaths only","a"),("B  deaths + severs","b")):
    X=[d[key] for d in D];Y=[d['y'] for d in D]
    k,r2=fit(X,Y); r=[y-k*x for x,y in zip(X,Y)]
    k1=1-sum((y-x)**2 for x,y in zip(X,Y))/sum(y*y for y in Y)
    print(f"{nm:20s} k={k:.3f} R^2={r2:.4f}  k=1 R^2={k1:.4f}")
    print(f"     residual by roster: "+str({c:round(statistics.mean([d['y']-k*d[key] for d in D if d['cell']==c]),3) for c in ('snake6','snake5-queen','snake5-knight')}))
    print(f"     corr(resid, severs)={corr([d['sev'] for d in D],r):+.3f}   corr(resid, turns)={corr([d['turns'] for d in D],r):+.3f}")
