# Is the remaining structure at the TERMINAL BOUNDARY rather than in the flows?
# Compare the last observed board state's share against the official sharePar.
import gzip,json,glob,statistics
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def corr(x,y):
    n=len(x);mx=statistics.mean(x);my=statistics.mean(y);sx=statistics.pstdev(x);sy=statistics.pstdev(y)
    if sx==0 or sy==0 or n<3: return float('nan')
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/(n*sx*sy)
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
        EX=defaultdict(float)
        for i in range(len(turns)-1):
            w0=defaultdict(float);w1=defaultdict(float)
            for s in turns[i]['board']['snakes']:   w0[s['teamID']]+=s['length']
            for s in turns[i+1]['board']['snakes']: w1[s['teamID']]+=s['length']
            W0=sum(w0.values()) or 1; W1=sum(w1.values()) or 1
            for tm,b in s2b.items(): EX[b]+= K*w1[tm]/W1 - K*w0[tm]/W0
        # share implied by the LAST OBSERVED board, vs the official sharePar
        wl=defaultdict(float)
        for s in turns[-1]['board']['snakes']: wl[s['teamID']]+=s['length']
        Wl=sum(wl.values()) or 1
        lastShare={s2b[tm]: K*w/Wl for tm,w in wl.items() if tm in s2b}
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T not in S or M not in S: continue
        D.append(dict(cell=label,ex=EX[T]-EX[M],y=S[T]-S[M],turns=res['turns'],
                      lastdiff=lastShare.get(T,0)-lastShare.get(M,0)))
X=[d['ex'] for d in D];Y=[d['y'] for d in D]
k=sum(a*b for a,b in zip(X,Y))/sum(a*a for a in X); r=[y-k*x for x,y in zip(X,Y)]
term=[d['y']-d['lastdiff'] for d in D]     # official sharePar minus last-board share
print(f"EXACT-fold residual: k={k:.3f}, corr(resid,turns)={corr([d['turns'] for d in D],r):+.3f}\n")
print(f"TERMINAL GAP (official sharePar - last-observed-board share):")
print(f"   mean {statistics.mean(term):+.4f}   sd {statistics.pstdev(term):.4f}")
print(f"   corr(terminal gap, turns)      = {corr([d['turns'] for d in D],term):+.3f}")
print(f"   corr(exact residual, terminal gap) = {corr(r,term):+.3f}   <- is the residual THE terminal gap?")
# how well does last-board share alone predict sharePar?
kk=sum(d['lastdiff']*d['y'] for d in D)/sum(d['lastdiff']**2 for d in D)
r2=1-sum((d['y']-kk*d['lastdiff'])**2 for d in D)/sum(d['y']**2 for d in D)
print(f"\n   last-board share alone: k={kk:.3f}  R^2={r2:.4f}   (vs exact-fold R^2 0.9705)")
