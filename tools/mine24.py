# Is the length-loading LINEARIZATION ERROR or a MISSING CHANNEL?
# Same clock, same decomposition; only the per-turn fold differs:
#   exact_t      = K*w1/W1 - K*w0/W0            (no linearization at all)
#   linearized_t = (K/W0)[(1-p)dOwn - p*dOth]   (mine)
# If exact removes the turns loading AND R^2 -> 1, ALL remaining residual is
# linearization error and there is no missing channel.
import gzip,json,glob,statistics
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def corr(x,y):
    n=len(x);mx=statistics.mean(x);my=statistics.mean(y);sx=statistics.pstdev(x);sy=statistics.pstdev(y)
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
        EX=defaultdict(float);LIN=defaultdict(float)
        for i in range(len(turns)-1):
            w0=defaultdict(float);w1=defaultdict(float)
            for s in turns[i]['board']['snakes']:   w0[s['teamID']]+=s['length']
            for s in turns[i+1]['board']['snakes']: w1[s['teamID']]+=s['length']
            W0=sum(w0.values()) or 1; W1=sum(w1.values()) or 1
            for tm,b in s2b.items():
                p=w0[tm]/W0
                EX[b]+= K*w1[tm]/W1 - K*w0[tm]/W0
                dOwn=w1[tm]-w0[tm]; dOth=(W1-w1[tm])-(W0-w0[tm])
                LIN[b]+= (K/W0)*((1-p)*dOwn - p*dOth)
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T not in S or M not in S: continue
        D.append(dict(cell=label,ex=EX[T]-EX[M],lin=LIN[T]-LIN[M],y=S[T]-S[M],turns=res['turns']))
print(f"{'per-turn fold':22s} {'k':>7s} {'R^2':>8s} {'k=1 R^2':>9s}   corr(resid,turns)")
out={}
for a,nm in (('lin','LINEARIZED (mine)'),('ex','EXACT dPhi')):
    X=[d[a] for d in D];Y=[d['y'] for d in D]
    k,r2=fit(X,Y);r=[y-k*x for x,y in zip(X,Y)]
    k1=1-sum((y-x)**2 for x,y in zip(X,Y))/sum(y*y for y in Y)
    out[a]=r
    print(f"{nm:22s} {k:7.3f} {r2:8.4f} {k1:9.4f}      {corr([d['turns'] for d in D],r):+.3f}")
gap=[d['ex']-d['lin'] for d in D]
print(f"\nlinearization gap (exact-linearized): mean {statistics.mean(gap):+.4f} sd {statistics.pstdev(gap):.4f}")
print(f"   corr(gap, turns) = {corr([d['turns'] for d in D],gap):+.3f}   <- does the error ACCUMULATE with turns?")
print(f"   corr(linearized residual, gap) = {corr(out['lin'],gap):+.3f}   <- is the residual THE gap?")
