# The residual loads on game length (-0.546). Hypothesis: flows compound, so a unit of
# weight preserved EARLY is worth more than one preserved LATE - and k as a CONSTANT
# cannot express that. Test a horizon weight (turnCap - t), known at decision time.
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
        CAP=hdr['config'].get('turnCap',120)
        acc={a:defaultdict(float) for a in ('flat','lin','sqrt')}
        for i in range(len(turns)-1):
            L0={s['id']:s['length'] for s in turns[i]['board']['snakes']}
            L1={s['id']:s['length'] for s in turns[i+1]['board']['snakes']}
            tn=turns[i]['turn']
            rem=max(0.0,(CAP-tn)/CAP)          # known at decision time, no leakage
            w0=defaultdict(float)
            for uid,l in L0.items(): w0[uid.rsplit('-',1)[0]]+=l
            W0=sum(w0.values()) or 1
            gain=defaultdict(float);lossD=defaultdict(float);lossS=defaultdict(float)
            for uid,l0 in L0.items():
                tm=uid.rsplit('-',1)[0]
                if uid not in L1: lossD[tm]+=l0
                else:
                    d=L1[uid]-l0
                    if d>0: gain[tm]+=d
                    elif d<0: lossS[tm]+=-d
            tl=sum(lossD.values())+sum(lossS.values())
            for tm,b in s2b.items():
                p=w0[tm]/W0
                base=(K/W0)*((1-p)*(gain[tm]-lossD[tm]-lossS[tm]) + p*(tl-lossD[tm]-lossS[tm]))
                acc['flat'][b]+=base
                acc['lin'][b] +=base*(1+rem)          # early flows worth up to 2x late
                acc['sqrt'][b]+=base*(1+rem**0.5)
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T not in S or M not in S: continue
        d=dict(cell=label,y=S[T]-S[M],turns=res['turns'])
        for a in acc: d[a]=acc[a][T]-acc[a][M]
        D.append(d)
print(f"{'horizon weighting':26s} {'k':>6s} {'R^2':>8s} {'k=1 R^2':>9s}  corr(resid,turns)")
for a,nm in (('flat','none (constant k)'),('sqrt','1+sqrt(remaining)'),('lin','1+remaining')):
    X=[d[a] for d in D];Y=[d['y'] for d in D]
    k,r2=fit(X,Y); r=[y-k*x for x,y in zip(X,Y)]
    k1=1-sum((y-x)**2 for x,y in zip(X,Y))/sum(y*y for y in Y)
    print(f"{nm:26s} {k:6.3f} {r2:8.4f} {k1:9.4f}      {corr([d['turns'] for d in D],r):+.3f}")
