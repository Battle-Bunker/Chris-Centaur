# Decompose the residual: MISSING CHANNEL vs LINEARIZATION ERROR.
# exact  dPhi_t = K*w'/W' - K*w/W          (telescopes to sharePar exactly - a tautology)
# approx dPhi_t = (K/W)[(1-p)dw_own + p*dw_others]   (my fold - first order)
# gap = exact - approx per turn.  Does the gap scale with weight churn (linearization)
# or load on severs after churn is controlled (missing channel)?
import gzip,json,glob,statistics
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def corr(x,y):
    n=len(x);mx=statistics.mean(x);my=statistics.mean(y)
    sx=statistics.pstdev(x);sy=statistics.pstdev(y)
    if sx==0 or sy==0 or n<3: return float('nan')
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/(n*sx*sy)
def partial(a,b,c):   # corr(a,b | c)
    def rz(v):
        s=statistics.pstdev(c)
        if s==0: return v
        beta=corr(c,v)*statistics.pstdev(v)/s; m=statistics.mean(v);mc=statistics.mean(c)
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
        prevstand=None;prevlen={}
        EX=defaultdict(float);AP=defaultdict(float);churn=0.0;sev=defaultdict(float)
        for t in turns:
            cur={s['id']:s['length'] for s in t['board']['snakes']}
            st={s['teamID']:s['material'] for s in t['standings']}
            if prevstand:
                W0=sum(prevstand.values()) or 1; W1=sum(st.values()) or 1
                churn+=sum(abs(st.get(k,0)-prevstand.get(k,0)) for k in set(st)|set(prevstand))
                for tm,b in s2b.items():
                    w0=prevstand.get(tm,0); w1=st.get(tm,0); p=w0/W0
                    EX[b]+= K*w1/W1 - K*w0/W0
                    dOwn=w1-w0
                    dOth=(W1-w1)-(W0-w0)
                    AP[b]+= (K/W0)*((1-p)*dOwn - p*dOth)
                for uid,cells in (t['events'].get('severedCells') or {}).items():
                    sev[s2b.get(uid.rsplit('-',1)[0])]+=len(cells) if isinstance(cells,list) else 0
            prevstand=st; prevlen=cur
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T not in S or M not in S: continue
        D.append(dict(cell=label,ex=EX[T]-EX[M],ap=AP[T]-AP[M],y=S[T]-S[M],
                      churn=churn,sev=sev[T]-sev[M],turns=res['turns']))
def fit(X,Y):
    k=sum(a*b for a,b in zip(X,Y))/sum(a*a for a in X)
    return k,1-sum((y-k*x)**2 for x,y in zip(X,Y))/sum(y*y for y in Y)
for nm,key in (("EXACT telescoped dPhi","ex"),("LINEARIZED fold (mine)","ap")):
    X=[d[key] for d in D];Y=[d['y'] for d in D]
    k,r2=fit(X,Y)
    print(f"{nm:24s}  k={k:.4f}  R^2={r2:.4f}   k=1 R^2={1-sum((y-x)**2 for x,y in zip(X,Y))/sum(y*y for y in Y):.4f}")
gap=[d['ex']-d['ap'] for d in D]
print(f"\nGAP (exact - linearized): mean {statistics.mean(gap):+.4f}  sd {statistics.pstdev(gap):.4f}")
print(f"   corr(gap, weight churn)          = {corr([d['churn'] for d in D],gap):+.3f}   <- linearization signature")
print(f"   corr(gap, severed cells)         = {corr([d['sev'] for d in D],gap):+.3f}")
print(f"   PARTIAL corr(gap, severs | churn)= {partial([d['sev'] for d in D],gap,[d['churn'] for d in D]):+.3f}   <- missing-channel signature")
