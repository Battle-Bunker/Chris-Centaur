# Does the terminal gap come from the ADJUDICATION RULE, or from the last turn being
# unobservable in the replay (no board[last+1])?  Split by ending type: games ending by
# elimination should already have converged; cap games are settled BY the rule.
import gzip,json,glob,statistics
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
from collections import defaultdict
g=defaultdict(list)
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
        K=len(hdr['config']['teams']); s2b={s['teamID']:s['bot'] for s in hdr['seats']}
        wl=defaultdict(float)
        for s in turns[-1]['board']['snakes']: wl[s['teamID']]+=s['length']
        Wl=sum(wl.values()) or 1
        last={s2b[tm]:K*w/Wl for tm,w in wl.items() if tm in s2b}
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T not in S or M not in S: continue
        gap=(S[T]-S[M])-(last.get(T,0)-last.get(M,0))
        anyelim=any(p['eliminatedOnTurn'] is not None for p in res['placements'])
        cap = 'elimination-in-game' if anyelim else 'no elimination'
        g[cap].append(abs(gap)); g['ALL'].append(abs(gap))
        g[('signed',cap)].append(gap)
print("terminal gap |sharePar - lastBoardShare|, by whether any team was eliminated:")
for k in ('no elimination','elimination-in-game','ALL'):
    v=g[k]; print(f"   {k:22s} n={len(v):3d}  mean|gap|={statistics.mean(v):.4f}  median={statistics.median(v):.4f}")
print("\nIf the gap were purely the UNOBSERVED LAST TURN, it would be similar in both groups.")
print("If it were the ADJUDICATION RULE, it should be larger where the rule does more work.")
