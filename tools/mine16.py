# F1: MARGINAL VALUE OF COMPUTE, from existing replays.
# Early-game (turns 5-20) plansEvaluated is near-exogenous: all teams have 6 units,
# positions are symmetric, so variation is mostly box contention. Does it predict sharePar?
import gzip,json,glob,statistics,math
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def corr(x,y):
    n=len(x);mx=statistics.mean(x);my=statistics.mean(y)
    sx=statistics.pstdev(x);sy=statistics.pstdev(y)
    if sx==0 or sy==0: return float('nan')
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/(n*sx*sy)
for batch,label in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight")]:
    per=defaultdict(lambda:{'p':[], 'y':[], 'u':[]})
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
        pe=defaultdict(list); un=defaultdict(list)
        for t in turns:
            if not (5<=t['turn']<=20): continue
            for team,tel in (t.get('telemetry') or {}).items():
                b=s2b.get(team)
                if isinstance(tel,dict) and isinstance(tel.get('plansEvaluated'),(int,float)):
                    pe[b].append(tel['plansEvaluated'])
            for st in t['standings']: un[s2b.get(st['teamID'])].append(st['units'])
        sp={p['bot']:p['sharePar'] for p in res['placements']}
        for b in pe:
            if pe[b] and b in sp:
                per[b]['p'].append(statistics.mean(pe[b])); per[b]['y'].append(sp[b])
                per[b]['u'].append(statistics.mean(un[b]) if un[b] else 6)
    print(f"--- {label} ---")
    for b in sorted(per):
        d=per[b]
        if len(d['p'])<10: continue
        # partial correlation of sharePar with plans, controlling for units alive
        def resid(a,c):
            mc=statistics.mean(c); sc=statistics.pstdev(c)
            if sc==0: return a
            beta=corr(c,a)*statistics.pstdev(a)/sc; ma=statistics.mean(a)
            return [x-(ma+beta*(z-mc)) for x,z in zip(a,c)]
        r=corr(d['p'],d['y']); rp=corr(resid(d['p'],d['u']),resid(d['y'],d['u']))
        lo,hi=min(d['p']),max(d['p'])
        print(f"   {b:20s} n={len(d['p']):3d}  plans/dec {statistics.mean(d['p']):6.0f} (range {lo:.0f}-{hi:.0f}, {100*(hi-lo)/statistics.mean(d['p']):.0f}% spread)")
        print(f"      corr(sharePar, plans) = {r:+.3f}   PARTIAL (controlling units alive) = {rp:+.3f}")
