# Is corr(resid,turns) really the ELIMINATION DISCONTINUITY in disguise?
# A linear flow fold cannot express a step; games that end early end by elimination.
import gzip,json,glob,statistics
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def corr(x,y):
    n=len(x);mx=statistics.mean(x);my=statistics.mean(y);sx=statistics.pstdev(x);sy=statistics.pstdev(y)
    if sx==0 or sy==0 or n<3: return float('nan')
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/(n*sx*sy)
def partial(a,b,c):
    def rz(v):
        s=statistics.pstdev(c)
        if s==0: return v
        beta=corr(c,v)*statistics.pstdev(v)/s;m=statistics.mean(v);mc=statistics.mean(c)
        return [x-(m+beta*(z-mc)) for x,z in zip(v,c)]
    return corr(rz(a),rz(b))
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
        B=defaultdict(float)
        for i in range(len(turns)-1):
            L0={s['id']:s['length'] for s in turns[i]['board']['snakes']}
            L1={s['id']:s['length'] for s in turns[i+1]['board']['snakes']}
            w0=defaultdict(float)
            for uid,l in L0.items(): w0[uid.rsplit('-',1)[0]]+=l
            W0=sum(w0.values()) or 1
            gain=defaultdict(float);lD=defaultdict(float);lS=defaultdict(float)
            for uid,l0 in L0.items():
                tm=uid.rsplit('-',1)[0]
                if uid not in L1: lD[tm]+=l0
                else:
                    d=L1[uid]-l0
                    if d>0: gain[tm]+=d
                    elif d<0: lS[tm]+=-d
            tl=sum(lD.values())+sum(lS.values())
            for tm,b in s2b.items():
                p=w0[tm]/W0
                B[b]+=(K/W0)*((1-p)*(gain[tm]-lD[tm]-lS[tm])+p*(tl-lD[tm]-lS[tm]))
        S={p['bot']:p['sharePar'] for p in res['placements']}
        el={p['bot']:(1 if p['eliminatedOnTurn'] is not None else 0) for p in res['placements']}
        nel=sum(el.values())
        T,M='lobster-territory','lobster-material'
        if T not in S or M not in S: continue
        D.append(dict(cell=label,x=B[T]-B[M],y=S[T]-S[M],turns=res['turns'],
                      nelim=nel, elimTM=el[T]-el[M]))
X=[d['x'] for d in D];Y=[d['y'] for d in D]
k=sum(a*b for a,b in zip(X,Y))/sum(a*a for a in X)
r=[y-k*x for x,y in zip(X,Y)]
print(f"basis B, k={k:.3f}\n")
print(f"  corr(resid, turns)                    = {corr([d['turns'] for d in D],r):+.3f}")
print(f"  corr(resid, #teams eliminated)        = {corr([d['nelim'] for d in D],r):+.3f}")
print(f"  corr(resid, elim(T)-elim(M))          = {corr([d['elimTM'] for d in D],r):+.3f}")
print(f"  PARTIAL corr(resid, turns | #elims)   = {partial([d['turns'] for d in D],r,[d['nelim'] for d in D]):+.3f}")
print(f"  PARTIAL corr(resid, #elims | turns)   = {partial([d['nelim'] for d in D],r,[d['turns'] for d in D]):+.3f}")
print(f"\n  corr(turns, #teams eliminated)        = {corr([d['turns'] for d in D],[d['nelim'] for d in D]):+.3f}")
# residual split by whether any elimination happened
for g,nm in ((0,"no elimination"),(1,">=1 elimination")):
    sub=[rr for rr,d in zip(r,D) if (d['nelim']>0)==bool(g)]
    if sub: print(f"  mean residual, {nm:16s} n={len(sub):3d}  {statistics.mean(sub):+.3f}")
