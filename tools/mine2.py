import gzip,json,sys,os,glob,statistics
from collections import defaultdict

def games(batch):
    for arm in ('nullA','nullB'):
        for d in glob.glob(f"{batch}/arms/{arm}/*"):
            if os.path.isdir(d):
                for f in sorted(glob.glob(d+"/*.jsonl.gz")): yield arm,f

def run(batch,label):
    deaths=defaultdict(lambda: defaultdict(int))   # bot -> cause -> n
    deaths_by_kind=defaultdict(lambda: defaultdict(int)) # bot -> unitkind -> n
    unitdeaths=defaultdict(lambda:[0,0])
    finalmat=defaultdict(list); peakmat=defaultdict(list); eaten=defaultdict(list)
    severs=defaultdict(int); severcells=defaultdict(int)
    ngames=0
    for arm,f in games(batch):
        hdr=None;res=None;turns=[]
        with gzip.open(f,'rt') as fh:
            for line in fh:
                r=json.loads(line)
                if r['kind']=='header':hdr=r
                elif r['kind']=='result':res=r
                elif r['kind']=='turn':turns.append(r)
        if not res: continue
        ngames+=1
        seat2bot={s['teamID']:s['bot'] for s in hdr['seats']}
        roster=hdr['config']['roster']
        # unit index -> kind ; ids are team-N
        for t in turns:
            for uid,d in (t['events'].get('deaths') or {}).items():
                team=uid.rsplit('-',1)[0]; idx=int(uid.rsplit('-',1)[1])
                bot=seat2bot.get(team)
                cause=d if isinstance(d,str) else (d.get('cause') if isinstance(d,dict) else str(d))
                deaths[bot][cause]+=1
                deaths_by_kind[bot][roster[idx] if idx<len(roster) else '?']+=1
            for uid,cells in (t['events'].get('severedCells') or {}).items():
                team=uid.rsplit('-',1)[0]; bot=seat2bot.get(team)
                severs[bot]+=1; severcells[bot]+=len(cells) if isinstance(cells,list) else 0
        traj=res.get('materialTrajectory',{})
        for team,tr in traj.items():
            bot=seat2bot.get(team)
            if tr: finalmat[bot].append(tr[-1]); peakmat[bot].append(max(tr))
    print(f"=== {label} ({ngames} games) ===")
    bots=sorted(finalmat)
    print(f"{'bot':22s} {'finalMat':>9s} {'peakMat':>8s} {'deaths/g':>9s} {'severs/g':>9s} {'sevCells/g':>10s}")
    for b in bots:
        tot=sum(deaths[b].values())
        print(f"{b:22s} {statistics.mean(finalmat[b]):9.1f} {statistics.mean(peakmat[b]):8.1f} {tot/ngames:9.2f} {severs[b]/ngames:9.2f} {severcells[b]/ngames:10.2f}")
    print(" death causes:")
    for b in bots:
        print(f"   {b:20s}", dict(sorted(deaths[b].items(),key=lambda kv:-kv[1])))
    print(" deaths by unit kind:")
    for b in bots:
        print(f"   {b:20s}", dict(deaths_by_kind[b]))
run(sys.argv[1],sys.argv[2])
