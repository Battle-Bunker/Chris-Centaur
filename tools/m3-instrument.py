"""M3: the admitted-set / point-of-comparison instrument.

Causes of an inert evaluator weight, distinguished by WHERE the spread dies:
  (a) NEVER ADMITTED   - option count exceeds the per-unit cap, so it never enters the priced set
  (b) NO GRADIENT      - the term is constant across the plans actually compared
  (c) SCALE SEPARATED  - the term varies but too little to clear the switch margin
  (e) RATE THROTTLED   - discovered here: the plan was refused by an emission rate limiter

(a) is exact: legal-move cardinality from the move grammar vs the shipped caps.
(b)/(c) use a geometric proxy for the territory features (bounded flood fill = `room`).
(e) is exact from the per-decision refusal spectrum.
"""
import gzip,json,glob,statistics,sys
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
CAP_NONSLIDER, CAP_SLIDER = 8, 4          # cluster-enum.ts:261-262
ORTH=[(1,0),(-1,0),(0,1),(0,-1)]
DIAG=[(1,1),(1,-1),(-1,1),(-1,-1)]
KNIGHT=[(1,2),(2,1),(2,-1),(1,-2),(-1,-2),(-2,-1),(-2,1),(-1,2)]
RAYS={'queen':ORTH+DIAG,'rook':ORTH,'bishop':DIAG}

def legal_dests(kind, body, occ, W, H):
    """Grammar-legal destinations. occ = set of occupied cells."""
    hx,hy = body[0]['x'], body[0]['y']
    out=[]
    if kind=='snake':
        neck=(body[1]['x'],body[1]['y']) if len(body)>1 else None
        for dx,dy in ORTH:
            c=(hx+dx,hy+dy)
            if 0<=c[0]<W and 0<=c[1]<H and c!=neck: out.append(c)
    elif kind=='knight':
        for dx,dy in KNIGHT:
            c=(hx+dx,hy+dy)
            if 0<=c[0]<W and 0<=c[1]<H: out.append(c)
    elif kind=='king':
        for dx,dy in ORTH+DIAG:
            c=(hx+dx,hy+dy)
            if 0<=c[0]<W and 0<=c[1]<H: out.append(c)
    elif kind in RAYS:
        for dx,dy in RAYS[kind]:
            x,y=hx,hy
            while True:
                x+=dx; y+=dy
                if not(0<=x<W and 0<=y<H): break
                out.append((x,y))
                if (x,y) in occ: break          # capture-stops
    return out

def interior(c,W,H): return 1<=c[0]<=W-2 and 1<=c[1]<=H-2

from collections import deque
HORIZON = 4          # calibration.ts REACH_HORIZON_TURNS

def bfs_dists(sources, blocked, W, H, horizon=HORIZON):
    """Multi-source BFS arrival times, bounded at `horizon`."""
    d={}; q=deque()
    for s in sources:
        if s not in d: d[s]=0; q.append(s)
    while q:
        c=q.popleft(); dc=d[c]
        if dc>=horizon: continue
        for dx,dy in ORTH:
            n=(c[0]+dx,c[1]+dy)
            if n in d or n in blocked: continue
            if not(0<=n[0]<W and 0<=n[1]<H): continue
            d[n]=dc+1; q.append(n)
    return d

def owned_room(dest, enemy_d, blocked, W, H):
    """`room` proxy: cells within HORIZON of `dest` that this unit reaches STRICTLY
    before any other unit. This is plane-1 per-unit ownership, and unlike a bounded
    flood fill it does not saturate on an open board."""
    mine = bfs_dists([dest], blocked, W, H)
    return sum(1 for c,dc in mine.items() if dc < enemy_d.get(c, 99))

def run(cells, every=7, maxgames=10):
    A=defaultdict(lambda: defaultdict(float)); N=defaultdict(int)
    potion_decisions=0; potion_reachable=0; total_decisions=0
    for batch,label in cells:
        files=sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz"))[:maxgames]
        for f in files:
            hdr=None
            try:
                with gzip.open(f,'rt') as fh:
                    for line in fh:
                        r=json.loads(line)
                        if r['kind']=='header': hdr=r; continue
                        if r['kind']!='turn' or hdr is None: continue
                        if r['turn']%every: continue
                        bd=r['board']; W,H=bd['width'],bd['height']
                        roster=hdr['config']['roster']
                        s2b={s['teamID']:s['bot'] for s in hdr['seats']}
                        occ=set(); 
                        for s in bd['snakes']:
                            for c in s['body']: occ.add((c['x'],c['y']))
                        pot={(p['x'],p['y']) for p in (bd.get('invulnerabilityPotions') or [])}
                        for s in bd['snakes']:
                            team,idx=s['id'].rsplit('-',1); idx=int(idx)
                            bot=s2b.get(team)
                            if bot=='reflex' or bot is None: continue
                            kind=roster[idx] if idx<len(roster) else 'snake'
                            cls='slider' if kind in RAYS else ('leaper' if kind=='knight' else 'snake')
                            dests=legal_dests(kind,s['body'],occ,W,H)
                            if not dests: continue
                            total_decisions+=1
                            if pot: potion_decisions+=1
                            if any(d in pot for d in dests): potion_reachable+=1
                            cap = CAP_SLIDER if cls=='slider' else CAP_NONSLIDER
                            surviving=[d for d in dests if interior(d,W,H) and d not in occ]
                            k=(label,cls)
                            N[k]+=1
                            A[k]['nLegal']+=len(dests); A[k]['nSurv']+=len(surviving)
                            A[k]['capBinds']+= 1 if len(dests)>cap else 0
                            A[k]['allDoomed']+= 1 if not surviving else 0
                            if len(surviving)>=2:
                                others=[(o['body'][0]['x'],o['body'][0]['y'])
                                        for o in bd['snakes'] if o['id']!=s['id']]
                                enemy_d=bfs_dists(others,occ,W,H)
                                samp = surviving if len(surviving)<=12 else surviving[::max(1,len(surviving)//12)]
                                fs=[owned_room(d,enemy_d,occ,W,H) for d in samp]
                                sp=max(fs)-min(fs)
                                A[k]['nCompared']+=1
                                A[k]['spread']+=sp
                                A[k]['zeroSpread']+= 1 if sp==0 else 0
                                A[k]['meanRoom']+=sum(fs)/len(fs)
                                A[k]['tinySpread']+= 1 if sp<=2 else 0
            except (EOFError,OSError,json.JSONDecodeError):
                pass
    return A,N,(total_decisions,potion_decisions,potion_reachable)

if __name__=='__main__':
    cells=[("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight"),("rl5","snake5-rook")]
    A,N,(td,pd,pr)=run(cells)
    print(f"{'cell':14s} {'class':7s} {'n':>6s} {'legal':>6s} {'surv':>6s} {'capBinds':>9s} {'allDoomed':>10s} {'meanRoom':>9s} {'roomSpread':>11s} {'zero':>6s} {'<=2':>6s}")
    for (cell,cls),d in sorted(A.items()):
        n=N[(cell,cls)]; nc=d['nCompared'] or 1
        print(f"{cell:14s} {cls:7s} {n:6d} {d['nLegal']/n:6.2f} {d['nSurv']/n:6.2f} "
              f"{100*d['capBinds']/n:8.0f}% {100*d['allDoomed']/n:9.0f}% {d['meanRoom']/nc:9.1f} {d['spread']/nc:11.2f} "
              f"{100*d['zeroSpread']/nc:5.0f}% {100*d['tinySpread']/nc:5.0f}%")
    print(f"\nPOTION REACHABILITY: {td} unit-decisions sampled; {pd} had a potion on the board; "
          f"{pr} ({100*pr/td:.2f}% of all, {100*pr/pd if pd else 0:.2f}% of those with a potion) had a potion AT A LEGAL DESTINATION.")
