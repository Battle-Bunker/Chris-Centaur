#!/usr/bin/env python3
"""
Supplier log-loss harness v0 — the D2 weight-supplier comparison instrument.

Spec: docs/design/belief-fog/02-PROJECTIONS-AND-WEIGHTS.md §4b; the epsilon law
in 11-EPSILON-LAW-AND-WORLDLINE.md Part A. Zero games: reads replay archives
(harness jsonl.gz, kind:header/turn/result records with full board snapshots)
and scores each supplier's predicted distribution over each unit's next action
against the action actually played (head/cell at t+1).

RULING-13 SCOPE: instrument work on logged data. No bot behavior touched, no
opponent-specific fitting (no per-centaurId strata by design).

V0 DECLARED APPROXIMATIONS (each measurable via the support-miss counter):
  - Action space = destination cells. Pawn rotations fold into 'stay'.
  - Support = in-bounds legal destinations minus blocked cells, where blocked
    = every unit's body cells MINUS tails (assumed to vacate; eating ignored)
    MINUS snake head cells (snakes must move). Piece heads may stay, so piece
    cells block. Own neck excluded for snakes. Sliders stop before the first
    blocked cell. Pawns: forward (if unblocked) + 2 forward diagonals + stay.
  - If the played action falls outside the generated support it is ADDED to
    the support for that decision and counted (supportMiss) — log-loss stays
    finite and the constructor's quality is reported, not hidden.
  - Every supplier's final weight = (1-LAMBDA)*core + LAMBDA*uniform over the
    decision's support (LAMBDA declared below, same floor for all suppliers,
    so log-loss comparisons are on equal smoothing).

EPSILON_MIN (coarse): per stratum, actions are pooled into canonical
categories (stay/straight/toward-food/toward-enemy/retreat/other); p(c) is
the smoothed empirical category distribution of played moves; wbar(c) the mean
supplier mass per category. eps_min = 1 - min_c p(c)/wbar(c) over categories
with wbar(c) >= WBAR_MIN. Coarsening can only LOWER the required
contamination, so this is a lower bound on the exact eps_min and is labeled
as such. CI: Wilson interval on p at the argmin category, propagated at fixed
wbar.

DECISION-WEIGHTED VARIANT (proxy, declared): the contact stratum (nearest
opposing head within L1 <= 2) stands in for "turns where the prediction could
change our action" until a re-decision harness exists.
"""

import gzip
import json
import math
import os
import sys
from collections import defaultdict

LAMBDA = 0.25          # uniform floor mixed into every supplier's core
WBAR_MIN = 0.01        # category admissibility threshold for eps_min
JEFFREYS = 0.5         # smoothing pseudo-count on category counts
COVER_RANGE_PAD = 2    # target gating: head L1 <= reach + pad

# opp/solutions@1 (M36/C40): weight(a) ~ count of valid same-team joint
# assignments with u playing a. Constraint system v0 (declared): per-unit
# supports (C0) + same-team same-destination exclusivity (rules-certain: own
# units contest and kill each other; head-swaps and unequal-weight survivor
# nuances NOT modeled — the constraint-violation counter measures the
# contamination of the constraint itself). Coupled subsets = same-team units
# with overlapping supports. C40 declaration: exact enumeration when the
# subset's joint product <= SOLUTIONS_EXACT_CAP; uniform sampling of
# SOLUTIONS_SAMPLE_K joints above it (the declared approximation whose error
# is this supplier's advisoryPrecision).
SOLUTIONS_EXACT_CAP = 20000
SOLUTIONS_SAMPLE_K = 500
import random as _random
_solrng = _random.Random(93101)

KIND_SNAKE = "snake"

DIRS4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
DIRS8 = DIRS4 + [(1, 1), (1, -1), (-1, 1), (-1, -1)]
KNIGHT = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]


def load_game(path):
    header, turns = None, []
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            k = d.get("kind")
            if k == "header":
                header = d
            elif k == "turn":
                turns.append(d)
    return header, turns


class Unit:
    __slots__ = ("uid", "team", "head", "body", "orient", "kind", "health", "length")

    def __init__(self, s):
        self.uid = s["id"]
        self.team = s.get("teamID", s["id"])
        self.head = (s["head"]["x"], s["head"]["y"])
        self.body = [(c["x"], c["y"]) for c in s.get("body", [])] or [self.head]
        o = s.get("orientation") or {"dx": 0, "dy": 0}
        self.orient = (o.get("dx", 0), o.get("dy", 0))
        self.kind = s.get("unitType") or KIND_SNAKE
        self.health = s.get("health", 100)
        self.length = s.get("length", len(self.body))


class Snapshot:
    def __init__(self, board):
        self.w = board["width"]
        self.h = board["height"]
        self.food = {(c["x"], c["y"]) for c in board.get("food", [])}
        self.units = [Unit(s) for s in board.get("snakes", [])]
        self.by_id = {u.uid: u for u in self.units}
        # blocked = all body cells - tails(len>1) - snake heads
        # piece_cells = cells held by piece units (capture-enterable: a head-on
        # contest, tier-then-weight — not rules-certain-fatal like a snake
        # trail interior)
        blocked = set()
        piece_cells = set()
        for u in self.units:
            cells = set(u.body)
            if u.length > 1 and len(u.body) > 1:
                cells.discard(u.body[-1])          # tail vacates
            if u.kind == KIND_SNAKE:
                cells.discard(u.head)              # snake head vacates
            else:
                piece_cells |= cells
            blocked |= cells
        self.blocked = blocked
        self.piece_cells = piece_cells

    def inb(self, c):
        return 0 <= c[0] < self.w and 0 <= c[1] < self.h


def rot45(d, sign):
    # rotate an orthogonal direction 45 degrees to a diagonal
    x, y = d
    if sign > 0:
        return (x - y, x + y) if False else _diag(d, +1)
    return _diag(d, -1)


def _diag(d, s):
    x, y = d
    if x != 0:
        return (x, s)
    return (s, y)


def support_of(u, snap):
    """Destination-cell support. Returns (cells, meta) — meta for categories."""
    hx, hy = u.head
    out = []
    if u.kind == KIND_SNAKE:
        neck = u.body[1] if len(u.body) > 1 else None
        for dx, dy in DIRS4:
            c = (hx + dx, hy + dy)
            if not snap.inb(c) or c == neck or c in snap.blocked:
                continue
            out.append(c)
    elif u.kind == "king":
        out.append(u.head)
        for dx, dy in DIRS8:
            c = (hx + dx, hy + dy)
            if snap.inb(c) and (c not in snap.blocked or c in snap.piece_cells):
                out.append(c)
    elif u.kind == "knight":
        out.append(u.head)
        for dx, dy in KNIGHT:
            c = (hx + dx, hy + dy)
            if snap.inb(c) and (c not in snap.blocked or c in snap.piece_cells):
                out.append(c)
    elif u.kind in ("rook", "queen", "bishop"):
        out.append(u.head)
        rays = DIRS4 if u.kind == "rook" else (
            [(1, 1), (1, -1), (-1, 1), (-1, -1)] if u.kind == "bishop" else DIRS8)
        for dx, dy in rays:
            c = (hx + dx, hy + dy)
            while snap.inb(c) and c not in snap.blocked:
                out.append(c)
                c = (c[0] + dx, c[1] + dy)
            # the stopping cell is a capture destination when a piece holds it
            if snap.inb(c) and c in snap.piece_cells:
                out.append(c)
    elif u.kind == "pawn":
        out.append(u.head)
        ox, oy = u.orient
        if (ox, oy) != (0, 0):
            fwd = (hx + ox, hy + oy)
            if snap.inb(fwd) and fwd not in snap.blocked:
                out.append(fwd)
            for s in (+1, -1):
                d = _diag((ox, oy), s)
                c = (hx + d[0], hy + d[1])
                if snap.inb(c):
                    out.append(c)
        else:
            for dx, dy in DIRS4:
                c = (hx + dx, hy + dy)
                if snap.inb(c) and c not in snap.blocked:
                    out.append(c)
    else:  # unknown kind: neighbors + stay
        out.append(u.head)
        for dx, dy in DIRS8:
            c = (hx + dx, hy + dy)
            if snap.inb(c) and c not in snap.blocked:
                out.append(c)
    # dedupe preserving order
    seen, cells = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            cells.append(c)
    return cells


def ray_path(a, b):
    """Cells from a (exclusive) to b (inclusive) along an orthogonal/diagonal ray."""
    ax, ay = a
    bx, by = b
    dx = (bx > ax) - (bx < ax)
    dy = (by > ay) - (by < ay)
    cells = []
    c = (ax + dx, ay + dy)
    while True:
        cells.append(c)
        if c == b:
            break
        c = (c[0] + dx, c[1] + dy)
        if len(cells) > 64:
            break
    return cells


MAX_REACH = {KIND_SNAKE: 1, "king": 1, "knight": 2, "pawn": 1, "rook": 64, "queen": 64, "bishop": 64}


def cover_counts(u, snap, support, support_cache):
    """Ruling-23 cover: for each of u's moves r, how many support-moves of
    opposing units does r hit (arrive on, or cross for sliders)."""
    reach = MAX_REACH.get(u.kind, 1) + COVER_RANGE_PAD
    slider = u.kind in ("rook", "queen", "bishop")
    targets = []
    for v in snap.units:
        if v.team == u.team or v.uid == u.uid:
            continue
        if abs(v.head[0] - u.head[0]) + abs(v.head[1] - u.head[1]) > reach + 2:
            continue
        if v.uid not in support_cache:
            support_cache[v.uid] = support_of(v, snap)
        tcells = set(support_cache[v.uid])
        if tcells:
            targets.append(tcells)
    counts = [0.0] * len(support)
    if not targets:
        return counts, False
    any_cover = False
    for i, r in enumerate(support):
        if r == u.head:
            continue  # staying covers nothing (no entry adjudication)
        cells = ray_path(u.head, r) if slider else [r]
        n = 0
        for tcells in targets:
            for c in cells:
                if c in tcells:
                    n += 1
        if n > 0:
            counts[i] = float(n)
            any_cover = True
    return counts, any_cover


def solutions_for_turn(snap, support_cache):
    """opp/solutions@1 per-turn pass. Returns (weights, coupled, stats):
    weights[uid] = dict dest->marginal count over valid same-team joint
    assignments of the unit's coupled subset; coupled = set of uids in a
    subset of size >= 2; stats = counters for the C40 declaration rows."""
    stats = {"exact": 0, "sampled": 0, "unresolved": 0, "violations": 0}
    weights = {}
    coupled = set()
    by_team = defaultdict(list)
    for u in snap.units:
        if u.uid not in support_cache:
            support_cache[u.uid] = support_of(u, snap)
        by_team[u.team].append(u)
    for team, units in by_team.items():
        sets = {u.uid: set(support_cache[u.uid]) for u in units}
        # overlap graph -> components (union by shared destination cells)
        comp = {u.uid: u.uid for u in units}

        def find(x):
            while comp[x] != x:
                comp[x] = comp[comp[x]]
                x = comp[x]
            return x

        for i in range(len(units)):
            for j in range(i + 1, len(units)):
                a, b = units[i], units[j]
                if sets[a.uid] & sets[b.uid]:
                    comp[find(a.uid)] = find(b.uid)
        groups = defaultdict(list)
        for u in units:
            groups[find(u.uid)].append(u)
        for members in groups.values():
            if len(members) < 2:
                continue
            supports = [support_cache[m.uid] for m in members]
            prod = 1
            for s in supports:
                prod *= max(1, len(s))
            counts = [defaultdict(float) for _ in members]
            if prod <= SOLUTIONS_EXACT_CAP:
                stats["exact"] += 1
                chosen = [None] * len(members)

                def dfs(i, used):
                    if i == len(members):
                        for k in range(len(members)):
                            counts[k][chosen[k]] += 1.0
                        return
                    for c in supports[i]:
                        if c in used:
                            continue
                        chosen[i] = c
                        used.add(c)
                        dfs(i + 1, used)
                        used.discard(c)

                dfs(0, set())
            else:
                stats["sampled"] += 1
                got = 0
                for _ in range(SOLUTIONS_SAMPLE_K):
                    pick = [s[_solrng.randrange(len(s))] for s in supports]
                    if len(set(pick)) == len(pick):
                        got += 1
                        for k, c in enumerate(pick):
                            counts[k][c] += 1.0
                if got == 0:
                    stats["unresolved"] += 1
                    continue  # units stay detached -> uniform (declared)
            if all(sum(c.values()) > 0 for c in counts):
                for m, c in zip(members, counts):
                    weights[m.uid] = c
                    coupled.add(m.uid)
    return weights, coupled, stats


def nearest(cell, cells):
    best, bd = None, 10 ** 9
    for c in cells:
        d = abs(c[0] - cell[0]) + abs(c[1] - cell[1])
        if d < bd:
            bd, best = d, c
    return best, bd


def suppliers_for(u, snap, support, support_cache, sol_weights, sol_coupled):
    """Return {name: [core weights aligned with support]} (pre-floor)."""
    n = len(support)
    uni = [1.0 / n] * n
    out = {"uniform": uni}

    # opp/solutions@1 — marginal model counts of the same-team joint CSP.
    # Detached units share uniform's OBJECT: the reduction of prediction (a)
    # is mechanical equality, not an approximation.
    if u.uid in sol_coupled:
        c = sol_weights[u.uid]
        tot = sum(c.values())
        out["solutions"] = [c.get(cell, 0.0) / tot for cell in support]
    else:
        out["solutions"] = uni

    # default-action: snake straight; piece stays
    if u.kind == KIND_SNAKE:
        d = (u.head[0] + u.orient[0], u.head[1] + u.orient[1])
    else:
        d = u.head
    core = [0.0] * n
    if d in support:
        core[support.index(d)] = 1.0
        out["default"] = core
    else:
        out["default"] = uni

    # greedy-food: point mass on the support move minimizing dist to nearest food
    if snap.food:
        best_i, bd = None, 10 ** 9
        for i, c in enumerate(support):
            _, dd = nearest(c, snap.food)
            if dd < bd:
                bd, best_i = dd, i
        core = [0.0] * n
        core[best_i] = 1.0
        out["food"] = core
    else:
        out["food"] = uni

    # cover + adversarial point
    counts, any_cover = cover_counts(u, snap, support, support_cache)
    if any_cover:
        s = sum(counts)
        out["cover"] = [c / s for c in counts]
        mx = max(range(n), key=lambda i: counts[i])
        core = [0.0] * n
        core[mx] = 1.0
        out["advpoint"] = core
    else:
        out["cover"] = uni
        out["advpoint"] = uni
    return out, any_cover


def category_of(u, snap, dest, enemy_heads):
    if dest == u.head:
        return "stay"
    if u.kind == KIND_SNAKE and dest == (u.head[0] + u.orient[0], u.head[1] + u.orient[1]):
        return "straight"
    if snap.food:
        _, dh = nearest(u.head, snap.food)
        _, dd = nearest(dest, snap.food)
        if dd < dh:
            return "toward-food"
    if enemy_heads:
        _, eh = nearest(u.head, enemy_heads)
        _, ed = nearest(dest, enemy_heads)
        if ed < eh:
            return "toward-enemy"
        if ed > eh:
            return "retreat"
    return "other"


class Agg:
    """Per (stratum, supplier) accumulator."""

    def __init__(self):
        self.n = 0
        self.sum_ll = 0.0
        self.sum_ll2 = 0.0
        self.cat_played = defaultdict(float)
        self.cat_w = defaultdict(float)

    def add(self, ll, played_cat, cat_mass):
        self.n += 1
        self.sum_ll += ll
        self.sum_ll2 += ll * ll
        self.cat_played[played_cat] += 1.0
        for c, m in cat_mass.items():
            self.cat_w[c] += m

    def logloss(self):
        if self.n == 0:
            return (float("nan"), float("nan"))
        m = self.sum_ll / self.n
        var = max(0.0, self.sum_ll2 / self.n - m * m)
        return (m, 1.96 * math.sqrt(var / self.n))

    def eps_min(self):
        """Coarse eps_min with Jeffreys smoothing + Wilson CI at argmin."""
        if self.n == 0:
            return None
        cats = set(self.cat_played) | set(self.cat_w)
        k = len(cats)
        tot = self.n + JEFFREYS * k
        best = None
        for c in cats:
            wbar = self.cat_w.get(c, 0.0) / self.n
            if wbar < WBAR_MIN:
                continue
            p = (self.cat_played.get(c, 0.0) + JEFFREYS) / tot
            ratio = p / wbar
            if best is None or ratio < best[0]:
                best = (ratio, c, p, wbar, self.cat_played.get(c, 0.0))
        if best is None:
            return None
        ratio, c, p, wbar, cnt = best
        eps = max(0.0, 1.0 - ratio)
        # Wilson interval on the raw category proportion
        z = 1.96
        nn = self.n
        ph = cnt / nn
        den = 1 + z * z / nn
        ctr = (ph + z * z / (2 * nn)) / den
        hw = z * math.sqrt(ph * (1 - ph) / nn + z * z / (4 * nn * nn)) / den
        lo_p, hi_p = max(0.0, ctr - hw), min(1.0, ctr + hw)
        eps_hi = max(0.0, 1.0 - lo_p / wbar)
        eps_lo = max(0.0, 1.0 - hi_p / wbar)
        return {"eps": eps, "lo": eps_lo, "hi": eps_hi, "cat": c, "p": p, "wbar": wbar}


def roster_class(header, snap0):
    kinds = {u.kind for u in snap0.units}
    if kinds == {KIND_SNAKE}:
        return "snakes"
    if any(k in kinds for k in ("rook", "queen")):
        return "sliders" if KIND_SNAKE not in kinds else "mix-slider"
    return "mix"


def main(argv):
    roots = argv or ["."]
    files = []
    for r in roots:
        if os.path.isfile(r):
            files.append(r)
            continue
        for dirpath, _, names in os.walk(r):
            for nm in names:
                if nm.endswith(".jsonl.gz") or nm.endswith(".jsonl"):
                    if "manifest" in nm:
                        continue
                    files.append(os.path.join(dirpath, nm))
    files.sort()
    sys.stderr.write(f"[harness] {len(files)} replay files\n")

    aggs = defaultdict(Agg)         # (stratum, supplier) -> Agg
    support_miss = defaultdict(int)  # kind -> misses
    support_tot = defaultdict(int)
    fallback_cover = 0
    decisions = 0
    games = 0
    sol_counters = defaultdict(int)

    for fi, path in enumerate(files):
        try:
            header, turns = load_game(path)
        except Exception as e:
            sys.stderr.write(f"[skip] {path}: {e}\n")
            continue
        if not turns or header is None:
            continue
        games += 1
        cfg = header.get("config", {})
        potions = "potions-on" if (cfg.get("potions", {}) or {}).get("enabled") else "potions-off"
        snaps = [Snapshot(t["board"]) for t in turns]
        rclass = roster_class(header, snaps[0])
        for ti in range(len(snaps) - 1):
            a, b = snaps[ti], snaps[ti + 1]
            support_cache = {}
            sol_weights, sol_coupled, sol_stats = solutions_for_turn(a, support_cache)
            for k in ("exact", "sampled", "unresolved"):
                sol_counters[k] += sol_stats[k]
            # constraint-violation audit: did any team actually play a
            # same-destination joint this turn?
            dests = defaultdict(list)
            for u in a.units:
                v = b.by_id.get(u.uid)
                if v is not None:
                    dests[(u.team, v.head)].append(u.uid)
            for (_, _), ids in dests.items():
                if len(ids) > 1:
                    sol_counters["violations"] += 1
            for u in a.units:
                v = b.by_id.get(u.uid)
                if v is None:
                    continue  # died or removed: choice unobserved in this format
                played = v.head
                if u.uid not in support_cache:
                    support_cache[u.uid] = support_of(u, a)
                support = list(support_cache[u.uid])
                if not support:
                    continue
                support_tot[u.kind] += 1
                if played not in support:
                    support.append(played)
                    support_miss[u.kind] += 1
                n = len(support)
                sup, any_cover = suppliers_for(u, a, support, support_cache, sol_weights, sol_coupled)
                if not any_cover:
                    fallback_cover += 1
                enemy_heads = [w.head for w in a.units if w.team != u.team]
                pi = support.index(played)
                played_cat = category_of(u, a, played, enemy_heads)
                cats = [category_of(u, a, c, enemy_heads) for c in support]
                # strata for this decision
                contact = "contact" if (enemy_heads and nearest(u.head, enemy_heads)[1] <= 2) else "quiet"
                if n <= 3:
                    bb = "b<=3"
                elif n <= 8:
                    bb = "b4-8"
                else:
                    bb = "b>=9"
                kindk = "snake" if u.kind == KIND_SNAKE else u.kind
                coup = "coupled" if u.uid in sol_coupled else "detached"
                strata = [
                    ("ALL",),
                    ("kind", kindk),
                    ("contact", contact),
                    ("branch", bb),
                    ("roster", rclass),
                    ("potion", potions),
                    ("kind+contact", kindk, contact),
                    ("coupling", coup),
                ]
                decisions += 1
                uni_leak = LAMBDA / n
                for name, core in sup.items():
                    w = [(1 - LAMBDA) * c + uni_leak for c in core]
                    ll = -math.log(max(w[pi], 1e-12))
                    cat_mass = defaultdict(float)
                    for i, c in enumerate(cats):
                        cat_mass[c] += w[i]
                    for st in strata:
                        aggs[(st, name)].add(ll, played_cat, cat_mass)
        if (fi + 1) % 200 == 0:
            sys.stderr.write(f"[harness] {fi+1}/{len(files)} files, {decisions} decisions\n")

    # ---- report ----
    supplier_names = ["uniform", "solutions", "default", "food", "cover", "advpoint"]
    strata_keys = sorted({k[0] for k in aggs}, key=str)
    print(f"# Supplier log-loss harness v0 — {games} games, {decisions} decisions")
    print(f"LAMBDA={LAMBDA} JEFFREYS={JEFFREYS} WBAR_MIN={WBAR_MIN}")
    miss = {k: (support_miss[k], support_tot[k]) for k in support_tot}
    print("support-miss by kind: " + ", ".join(
        f"{k}: {m}/{t} ({100.0*m/t:.2f}%)" for k, (m, t) in sorted(miss.items())))
    print(f"cover-fallback-to-uniform: {fallback_cover}/{decisions} "
          f"({100.0*fallback_cover/max(1,decisions):.1f}%)")
    print("solutions (C40 declaration): "
          f"components exact={sol_counters['exact']} sampled={sol_counters['sampled']} "
          f"unresolved-to-uniform={sol_counters['unresolved']}; "
          f"played same-team same-dest joints (constraint contamination): "
          f"{sol_counters['violations']}")
    print()
    for st in strata_keys:
        a0 = aggs.get((st, "uniform"))
        if a0 is None or a0.n < 200:
            continue
        print(f"## stratum {st}  (n={a0.n})")
        print("| supplier | log-loss | ±CI | vs uniform | eps_min^coarse [CI] | argmin cat (p vs wbar) |")
        print("|---|---|---|---|---|---|")
        base = a0.logloss()[0]
        for name in supplier_names:
            g = aggs.get((st, name))
            if g is None or g.n == 0:
                continue
            m, ci = g.logloss()
            e = g.eps_min()
            es = (f"{e['eps']:.3f} [{e['lo']:.3f},{e['hi']:.3f}]"
                  if e else "n/a")
            ec = f"{e['cat']} ({e['p']:.3f} vs {e['wbar']:.3f})" if e else ""
            print(f"| {name} | {m:.4f} | {ci:.4f} | {m-base:+.4f} | {es} | {ec} |")
        print()


if __name__ == "__main__":
    main(sys.argv[1:])
