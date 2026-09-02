# RESIDUAL STRUCTURE TEST (asked for by the epistemics lens).
# If the 3-flow basis is RIGHT, residuals should be white across rosters/turns/events.
# If WRONG-but-exhaustive, residuals should LOAD on some event class.
import gzip,json,glob,statistics,math
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def corr(x,y):
    n=len(x)
    if n<3: return float('nan')
    mx=statistics.mean(x);my=statistics.mean(y);sx=statistics.pstdev(x);sy=statistics.pstdev(y)
    if sx==0 or sy==0: return float('nan')
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
        prevlen={};prevstand=None;N=defaultdict(float)
        ev=defaultdict(lambda: defaultdict(float))
        for t in turns:
            if prevstand:
                W=sum(s['material'] for s in prevstand) or 1
                sh={s['teamID']:s['material']/W for s in prevstand}
                loss=defaultdict(float);gain=defaultdict(float)
                for uid,d in (t['events'].get('deaths') or {}).items():
                    tm=uid.rsplit('-',1)[0];loss[tm]+=prevlen.get(uid,1)
                    c=d if isinstance(d,str) else ''
                    ev[s2b.get(tm)]['death_'+str(c)]+=1
                for s in t['board']['snakes']:
                    dd=s['length']-prevlen.get(s['id'],s['length'])
                    if dd>0: gain[s['id'].rsplit('-',1)[0]]+=dd
                tl=sum(loss.values())
                for tm,b in s2b.items():
                    N[b]+=(K/W)*((1-sh.get(tm,0))*(gain[tm]-loss[tm])+sh.get(tm,0)*(tl-loss[tm]))
                for uid,cells in (t['events'].get('severedCells') or {}).items():
                    ev[s2b.get(uid.rsplit('-',1)[0])]['severed']+=len(cells) if isinstance(cells,list) else 0
                ev[None]['elims']+=len(t['events'].get('eliminatedTeamIDs') or [])
                ev[None]['potions']+=len(t.get('world',{}).get('potionsCollected') or [])
            prevlen={s['id']:s['length'] for s in t['board']['snakes']}
            prevstand=t['standings']
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T not in S or M not in S: continue
        D.append(dict(cell=label, x=N[T]-N[M], y=S[T]-S[M], turns=res['turns'],
                      elims=ev[None]['elims'], potions=ev[None]['potions'],
                      sev=ev[T]['severed']-ev[M]['severed'],
                      contest=ev[T]['death_contest']-ev[M]['death_contest'],
                      exh=ev[T]['death_exhaustion']-ev[M]['death_exhaustion'],
                      bodyblk=ev[T]['death_bodyBlock']-ev[M]['death_bodyBlock']))
for k,name in [(1.0,"k=1 (identity)"),(1.227,"k=1.227 (fitted)")]:
    r=[d['y']-k*d['x'] for d in D]
    print(f"\n=== residual structure, {name}  (n={len(D)}, mean {statistics.mean(r):+.3f}, sd {statistics.pstdev(r):.3f}) ===")
    print("  by roster:", {c: round(statistics.mean([d['y']-k*d['x'] for d in D if d['cell']==c]),3) for c in ('snake6','snake5-queen','snake5-knight')})
    for v in ('elims','potions','sev','contest','exh','bodyblk','turns'):
        print(f"    corr(residual, {v:8s}) = {corr([d[v] for d in D], r):+.3f}")
