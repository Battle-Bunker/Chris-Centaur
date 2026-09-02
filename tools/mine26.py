# Does the fold predict SPREAD, not just level?
# share spread should = (K/W)(1-p) x weight spread.  Test per cell:
# does SD(sharePar) match (K/W_mean) x SD(terminal team weight)?
import gzip,json,glob,statistics
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
print(f"{'cell':16s} {'SD(sharePar)':>13s} {'SD(term wt)':>12s} {'mean W':>8s} {'K/W':>7s} {'predicted SD':>13s} {'ratio':>7s}")
for batch,label in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight")]:
    sp=[];wt=[];Ws=[]
    for f in sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz")):
        hdr=None;res=None
        try:
            with gzip.open(f,'rt') as fh:
                for line in fh:
                    r=json.loads(line)
                    if r['kind']=='header':hdr=r
                    elif r['kind']=='result':res=r
        except Exception: pass
        if not(hdr and res): continue
        K=len(hdr['config']['teams'])
        mats=[p['adjudicatedMaterial'] for p in res['placements']]
        W=sum(mats) or 1; Ws.append(W)
        for p in res['placements']:
            sp.append(p['sharePar']); wt.append(p['adjudicatedMaterial'])
    Wm=statistics.mean(Ws); KW=K/Wm
    sd_sp=statistics.pstdev(sp); sd_wt=statistics.pstdev(wt)
    pred=KW*sd_wt
    print(f"{label:16s} {sd_sp:13.3f} {sd_wt:12.2f} {Wm:8.1f} {KW:7.4f} {pred:13.3f} {sd_sp/pred if pred else 0:7.3f}")
print("\nIf the fold's conversion factor is right, 'ratio' should be ~1 and CONSTANT across cells.")
