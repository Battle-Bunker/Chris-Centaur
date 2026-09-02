"""AMENDED V-ALIGNMENT METER (rank-based) + M72 entropy ladder, one pass.

Primary   : pairwise order agreement - over (played, not-played) pairs from the legal set,
            the fraction on which V agrees with played > other. Ties = 0.5. 0.5 = chance.
Secondary : mean normalised rank of the played action (0 = always first, 0.5 = random).
M72       : H(played direction | context) at increasing context richness. Collapse toward 0
            => deterministic population + state pooling => no smooth supplier is identifiable
            on this corpus and the meter MUST be rank-based.
"""
import gzip,json,glob,math,statistics,random
from collections import defaultdict,deque,Counter
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
ORTH=[(1,0),(-1,0),(0,1),(0,-1)]; DIAG=[(1,1),(1,-1),(-1,1),(-1,-1)]
KN=[(1,2),(2,1),(2,-1),(1,-2),(-1,-2),(-2,-1),(-2,1),(-1,2)]
RAYS={'queen':ORTH+DIAG,'rook':ORTH,'bishop':DIAG}
HZ=4
def dests(kind,body,occ,W,H):
    hx,hy=body[0]['x'],body[0]['y']; out=[]
    if kind=='snake':
        neck=(body[1]['x'],body[1]['y']) if len(body)>1 else None
        for dx,dy in ORTH:
            c=(hx+dx,hy+dy)
            if 0<=c[0]<W and 0<=c[1]<H and c!=neck: out.append(c)
    elif kind=='knight':
        for dx,dy in KN:
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
                x+=dx;y+=dy
                if not(0<=x<W and 0<=y<H): break
                out.append((x,y))
                if (x,y) in occ: break
    return out
def bfs(src,blocked,W,H,hz=HZ):
    d={};q=deque()
    for s in src:
        if s not in d: d[s]=0;q.append(s)
    while q:
        c=q.popleft();dc=d[c]
        if dc>=hz: continue
        for dx,dy in ORTH:
            n=(c[0]+dx,c[1]+dy)
            if n in d or n in blocked or not(0<=n[0]<W and 0<=n[1]<H): continue
            d[n]=dc+1;q.append(n)
    return d
def agree_and_rank(vals,pi):
    """pairwise order agreement and normalised rank of index pi."""
    n=len(vals)
    if n<2: return None,None
    v=vals[pi]; better=sum(1 for k,x in enumerate(vals) if k!=pi and x>v)
    ties=sum(1 for k,x in enumerate(vals) if k!=pi and x==v)
    worse=n-1-better-ties
    agree=(worse+0.5*ties)/(n-1)
    rank=(better+0.5*ties)/(n-1)
    return agree,rank
def run(cells,every=7,maxg=10):
    A=defaultdict(lambda: defaultdict(list))   # V -> stratum -> [agree]
    R=defaultdict(lambda: defaultdict(list))
    ent=defaultdict(Counter)
    for batch,label in cells:
        for f in sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz"))[:maxg]:
            hdr=None;turns=[]
            try:
                with gzip.open(f,'rt') as fh:
                    for line in fh:
                        r=json.loads(line)
                        if r['kind']=='header':hdr=r
                        elif r['kind']=='turn':turns.append(r)
            except Exception: pass
            if not(hdr and turns): continue
            roster=hdr['config']['roster']; s2b={s['teamID']:s['bot'] for s in hdr['seats']}
            K=len(hdr['config']['teams'])
            for i in range(len(turns)-1):
                if turns[i]['turn']%every: continue
                bd=turns[i]['board']; W,H=bd['width'],bd['height']
                occ=set(); occP=set(); heads={}
                for s in bd['snakes']:
                    b=s['body']
                    for c in b: occ.add((c['x'],c['y']))
                    # PERSISTENT occupancy: drop each unit's last segment, which vacates
                    # as the unit advances. Pieces occupy one cell and do not vacate it.
                    keep = b[:-1] if len(b)>1 else b
                    for c in keep: occP.add((c['x'],c['y']))
                    heads[s['id']]=(b[0]['x'],b[0]['y'])
                food={(p['x'],p['y']) for p in bd['food']}
                wt={s['id']:s['length'] for s in bd['snakes']}
                tw=defaultdict(float)
                for s in bd['snakes']: tw[s['teamID']]+=s['length']
                Wt=sum(tw.values()) or 1
                nxt={s['id']:(s['body'][0]['x'],s['body'][0]['y']) for s in turns[i+1]['board']['snakes']}
                for s in bd['snakes']:
                    team,idx=s['id'].rsplit('-',1); idx=int(idx); bot=s2b.get(team)
                    if bot in (None,'reflex'): continue
                    kind=roster[idx] if idx<len(roster) else 'snake'
                    D=dests(kind,s['body'],occ,W,H)
                    if len(D)<2: continue
                    played=nxt.get(s['id'])
                    if played not in D: continue
                    pi=D.index(played)
                    p=tw[team]/Wt; wu=wt[s['id']]
                    others=[h for k,h in heads.items() if k!=s['id']]
                    ed=bfs(others,occ,W,H)
                    coupled=any(any(abs(d[0]-o[0])+abs(d[1]-o[1])<=1 for o in others) for d in D)
                    strat='coupled' if coupled else 'detached'
                    vraw=[];vfold=[];vfood=[]
                    for d in D:
                        # The PERIMETER IS PLAYABLE (21.7% of body cells sit on it and food
                        # spawns there). An earlier `isInterior` test here flagged 26% of
                        # played moves as suicide and inverted V - see MEAS-2.
                        fatal = (d in occP)
                        if fatal: hz=1.0
                        else:
                            mine=bfs([d],occ,W,H)
                            room=sum(1 for c,dc in mine.items() if dc<ed.get(c,99))
                            hz=1.0/(1.0+room)
                        fo=1.0 if d in food else 0.0
                        cap=0.0
                        for k2,h2 in heads.items():
                            if h2==d and k2.rsplit('-',1)[0]!=team and wt[k2]<wu: cap=wt[k2]
                        vraw.append(fo - wu*hz + cap)
                        vfold.append((K/Wt)*((1-p)*(fo - wu*hz) + p*cap))
                        if food:
                            vfood.append(-min(abs(d[0]-g[0])+abs(d[1]-g[1]) for g in food))
                        else: vfood.append(0.0)
                    for nm,vv in (('V_raw',vraw),('V_fold',vfold),('V_food',vfood)):
                        a,r=agree_and_rank(vv,pi)
                        if a is None: continue
                        A[nm][strat].append(a); A[nm]['all'].append(a)
                        R[nm][strat].append(r); R[nm]['all'].append(r)
                    # M72 entropy ladder
                    dirv=(played[0]-heads[s['id']][0], played[1]-heads[s['id']][1])
                    dirv=(max(-1,min(1,dirv[0])),max(-1,min(1,dirv[1])))
                    nb=tuple(1 if (heads[s['id']][0]+dx,heads[s['id']][1]+dy) in occ else 0 for dx,dy in ORTH)
                    fdir=(0,0)
                    if food:
                        g=min(food,key=lambda g:abs(g[0]-heads[s['id']][0])+abs(g[1]-heads[s['id']][1]))
                        fdir=(max(-1,min(1,g[0]-heads[s['id']][0])),max(-1,min(1,g[1]-heads[s['id']][1])))
                    win=tuple(1 if (heads[s['id']][0]+dx,heads[s['id']][1]+dy) in occ else 0
                              for dx in (-2,-1,0,1,2) for dy in (-2,-1,0,1,2))
                    ctxs={0:(),1:(kind,),2:(kind,nb),3:(kind,nb,fdir),4:(kind,nb,fdir,win),
                          5:(kind,nb,fdir,win,s['id'],turns[i]['turn'])}
                    for lv,c in ctxs.items(): ent[lv][(c,dirv)]+=1
    return A,R,ent
def H(counter):
    ctx=defaultdict(Counter)
    for (c,a),n in counter.items(): ctx[c][a]+=n
    tot=sum(counter.values()); h=0.0
    for c,cnt in ctx.items():
        m=sum(cnt.values()); hh=-sum((v/m)*math.log2(v/m) for v in cnt.values() if v)
        h+=(m/tot)*hh
    return h, len(ctx), tot
if __name__=='__main__':
    cells=[("rl1","snake6"),("rl4","queen"),("rl3","knight"),("rl5","rook")]
    A,R,ent=run(cells)
    print("PAIRWISE ORDER AGREEMENT (0.5 = chance; higher = V ranks the played move above alternatives)\n")
    print(f"{'V':10s} {'all':>18s} {'detached':>18s} {'coupled':>18s}")
    for nm in ('V_fold','V_raw','V_food'):
        row=f"{nm:10s}"
        for st in ('all','detached','coupled'):
            v=A[nm][st]
            if not v: row+=f"{'-':>18s}"; continue
            m=statistics.mean(v); se=statistics.pstdev(v)/math.sqrt(len(v))
            row+=f"  {m:.4f}+-{1.96*se:.4f} n={len(v)//1000}k" if len(v)>=1000 else f"  {m:.4f}+-{1.96*se:.4f}"
        print(row)
    print("\nMEAN NORMALISED RANK (0 = always ranked first, 0.5 = random)")
    for nm in ('V_fold','V_raw','V_food'):
        v=R[nm]['all']; print(f"   {nm:10s} {statistics.mean(v):.4f}   n={len(v)}")
    print("\nM72 ENTROPY LADDER - H(played direction | context), bits")
    names={0:'nothing',1:'+unit kind',2:'+neighbour occupancy',3:'+nearest-food direction',
           4:'+5x5 occupancy window',5:'+unit id and turn'}
    for lv in sorted(ent):
        h,nc,tot=H(ent[lv]); print(f"   L{lv} {names[lv]:26s} H={h:.4f}  contexts={nc:6d}  n={tot}")
