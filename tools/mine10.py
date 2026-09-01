# Is terminal sharePar better predicted by terminal WEIGHT or by UNIT COUNT?
# If elimination dominates, unit count (a conjunction buffer) carries independent signal.
import gzip,json,glob,statistics,math
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def corr(x,y):
    n=len(x); mx=statistics.mean(x); my=statistics.mean(y)
    sx=statistics.pstdev(x); sy=statistics.pstdev(y)
    if sx==0 or sy==0: return float('nan')
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/(n*sx*sy)
for batch,label in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight")]:
    # at turn 60 (mid-game), predict final sharePar from weight-share vs unit count
    W=[];U=[];Y=[];Wsh=[]
    for f in sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz")):
        hdr=None;res=None;mid=None
        try:
            with gzip.open(f,'rt') as fh:
                for line in fh:
                    r=json.loads(line)
                    if r['kind']=='header':hdr=r
                    elif r['kind']=='result':res=r
                    elif r['kind']=='turn' and r['turn']==60: mid=r
        except Exception: pass
        if not(hdr and res and mid): continue
        sp={p['teamID']:p['sharePar'] for p in res['placements']}
        tot=sum(s['material'] for s in mid['standings']) or 1
        for s in mid['standings']:
            if s['teamID'] not in sp: continue
            W.append(s['material']); U.append(s['units']); Wsh.append(s['material']/tot); Y.append(sp[s['teamID']])
    if not Y: continue
    print(f"--- {label} (n={len(Y)} team-observations at turn 60) ---")
    print(f"    corr(final sharePar, weight@60)       = {corr(W,Y):+.3f}")
    print(f"    corr(final sharePar, weight SHARE@60) = {corr(Wsh,Y):+.3f}")
    print(f"    corr(final sharePar, UNIT COUNT@60)   = {corr(U,Y):+.3f}")
    print(f"    corr(weight@60, unit count@60)        = {corr(W,U):+.3f}")
    # partial: does unit count add beyond weight share? residualize
    b=corr(Wsh,U)*statistics.pstdev(U)/ (statistics.pstdev(Wsh) or 1)
    mu=statistics.mean(U); mw=statistics.mean(Wsh)
    resU=[u-(mu+b*(w-mw)) for u,w in zip(U,Wsh)]
    print(f"    PARTIAL corr(sharePar, unit count | weight share) = {corr(resU,Y):+.3f}")
