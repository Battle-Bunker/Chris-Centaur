import gzip,json,sys,os,glob,statistics
from collections import defaultdict
def games(batch):
    for arm in ('nullA','nullB'):
        for d in glob.glob(f"{batch}/arms/{arm}/*"):
            if os.path.isdir(d):
                for f in sorted(glob.glob(d+"/*.jsonl.gz")): yield arm,f
def run(batch,label):
    sp=defaultdict(list); allsp=[]; elim=defaultdict(int); knightdied=defaultdict(int)
    teamselim=[]; ng=0
    for arm,f in games(batch):
        hdr=None;res=None;turns=[]
        with gzip.open(f,'rt') as fh:
            for line in fh:
                r=json.loads(line)
                if r['kind']=='header':hdr=r
                elif r['kind']=='result':res=r
                elif r['kind']=='turn':turns.append(r)
        if not res: continue
        ng+=1
        s2b={s['teamID']:s['bot'] for s in hdr['seats']}
        roster=hdr['config']['roster']
        kdead=defaultdict(bool)
        for t in turns:
            for uid in (t['events'].get('deaths') or {}):
                team=uid.rsplit('-',1)[0]; idx=int(uid.rsplit('-',1)[1])
                if idx<len(roster) and roster[idx]!='snake': kdead[team]=True
        ne=0
        for p in res['placements']:
            sp[p['bot']].append(p['sharePar']); allsp.append(p['sharePar'])
            if p['eliminatedOnTurn'] is not None: elim[p['bot']]+=1; ne+=1
            if kdead.get(p['teamID']): knightdied[p['bot']]+=1
        teamselim.append(ne)
    print(f"=== {label} ({ng} games) ===")
    print(f"  sharePar pooled: mean={statistics.mean(allsp):.3f} SD={statistics.pstdev(allsp):.3f}  range [{min(allsp):.2f},{max(allsp):.2f}]")
    print(f"  teams eliminated per game: mean {statistics.mean(teamselim):.2f}")
    for b in sorted(sp):
        v=sp[b]
        print(f"  {b:20s} mean={statistics.mean(v):.3f} SD={statistics.pstdev(v):.3f}  elim={elim[b]:2d}/{len(v)}  pieceUnitDied={knightdied[b]:2d}/{len(v)}")
run(sys.argv[1],sys.argv[2])
