import gzip,json,glob,statistics,math,sys
from collections import defaultdict
def ci(v):
    n=len(v); m=statistics.mean(v); s=statistics.stdev(v) if n>1 else 0
    h=1.96*s/math.sqrt(n) if n>1 else 0; return m,m-h,m+h
def run(batch,label):
    plen=defaultdict(list); slen=defaultdict(list); conc=defaultdict(list)
    pieceAliveScore=defaultdict(lambda:[[],[]])
    ng=0
    for f in sorted(glob.glob(f"/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad/continuous/{batch}/arms/*/*/*.jsonl.gz")):
        hdr=None;last=None;res=None
        with gzip.open(f,'rt') as fh:
            for line in fh:
                r=json.loads(line)
                if r['kind']=='header':hdr=r
                elif r['kind']=='turn':last=r
                elif r['kind']=='result':res=r
        if not (hdr and last and res): continue
        ng+=1
        s2b={s['teamID']:s['bot'] for s in hdr['seats']}
        roster=hdr['config']['roster']
        pidx={i for i,k in enumerate(roster) if k!='snake'}
        byteam=defaultdict(lambda:{'p':0,'s':0,'palive':False})
        for s in last['board']['snakes']:
            team,idx=s['id'].rsplit('-',1); idx=int(idx)
            if idx in pidx: byteam[team]['p']+=s['length']; byteam[team]['palive']=True
            else: byteam[team]['s']+=s['length']
        sp={p['teamID']:p['sharePar'] for p in res['placements']}
        for team,d in byteam.items():
            b=s2b.get(team)
            tot=d['p']+d['s']
            if d['palive']: plen[b].append(d['p'])
            slen[b].append(d['s'])
            if tot>0: conc[b].append(d['p']/tot)
            pieceAliveScore[b][0 if d['palive'] else 1].append(sp.get(team,0))
    print(f"=== {label} ({ng} games) ===")
    print(f"{'bot':22s} {'piece wt (alive)':>18s} {'snakes wt':>10s} {'piece share of team':>20s}")
    for b in sorted(conc):
        pm=statistics.mean(plen[b]) if plen[b] else float('nan')
        print(f"{b:22s} {pm:18.1f} {statistics.mean(slen[b]):10.1f} {100*statistics.mean(conc[b]):19.0f}%")
    print("  sharePar by whether the team's PIECE was still alive at the end:")
    for b in sorted(pieceAliveScore):
        a,d=pieceAliveScore[b]
        sa=f"{statistics.mean(a):.3f} (n={len(a)})" if a else "n/a"
        sd=f"{statistics.mean(d):.3f} (n={len(d)})" if d else "n/a"
        print(f"    {b:20s} piece ALIVE {sa:18s}   piece DEAD {sd}")
run(sys.argv[1],sys.argv[2])
