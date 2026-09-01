# Test the FOLD: does dS = (K/W)(1-p) * dw collapse the three cells to ONE coefficient?
# Weight lost to death, discounted at the moment of death by (K/W)(1-p), summed per team.
import gzip,json,glob,statistics,math
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def ci(v):
    n=len(v); m=statistics.mean(v); s=statistics.stdev(v) if n>1 else 0
    return m,m-1.96*s/math.sqrt(n),m+1.96*s/math.sqrt(n)
print(f"{'cell':16s} {'sharePar(T-M)':>14s} {'rawWt(T-M)':>11s} {'k_raw':>8s} | {'foldedWt(T-M)':>14s} {'k_fold':>8s}")
res_rows=[]
for batch,label in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight")]:
    raw=[];fold=[];sp=[]
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
        prevlen={}; prevstand=None
        R=defaultdict(float); F=defaultdict(float)
        for t in turns:
            for uid in (t['events'].get('deaths') or {}):
                team=uid.rsplit('-',1)[0]; b=s2b.get(team)
                w=prevlen.get(uid,1)
                R[b]+=w
                if prevstand:
                    W=sum(s['material'] for s in prevstand) or 1
                    mine=next((s['material'] for s in prevstand if s['teamID']==team),0)
                    p=mine/W
                    F[b]+= (K/W)*(1-p)*w     # the fold: loss of our own weight
            prevlen={s['id']:s['length'] for s in t['board']['snakes']}
            prevstand=t['standings']
        S={p['bot']:p['sharePar'] for p in result['placements']}
        T,M='lobster-territory','lobster-material'
        if T in S and M in S:
            raw.append(R[T]-R[M]); fold.append(F[T]-F[M]); sp.append(S[T]-S[M])
    s=ci(sp); r=ci(raw); fo=ci(fold)
    kr = s[0]/-r[0] if r[0] else float('nan')
    kf = s[0]/-fo[0] if fo[0] else float('nan')
    print(f"{label:16s} {s[0]:+14.3f} {r[0]:+11.2f} {kr:8.4f} | {fo[0]:+14.3f} {kf:8.3f}")
    res_rows.append((label,kr,kf))
ks=[r[1] for r in res_rows]; kf=[r[2] for r in res_rows]
print(f"\nspread of k across cells (max/min):  raw weight = {max(ks)/min(ks):.2f}x    FOLDED = {max(kf)/min(kf):.2f}x")
