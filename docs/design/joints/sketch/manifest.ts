/**
 * SKETCH — the joint manifest, the bot value, and the checks, as compiling code.
 *
 * NOT SHIPPING CODE. This file exists to answer one question with a number
 * rather than a fear: the red team's sharpest structural complaint is that the
 * generator "is a compiler; it will have bugs and it is upstream of
 * everything", and that the carve trades duplication for prerequisites. So this
 * is the whole spine — manifest, member, choice, bot, normalisation, address,
 * diff, and the three CI checks — written out, with nothing imported from the
 * repo. Read the line count at the bottom of `SKETCH.md` before judging the
 * proposal's cost.
 *
 * It deliberately does NOT implement any joint's semantics. A manifest row
 * carries a codec and a law; what a move selector or an evaluator DOES is the
 * member's business and lives in the kernel, exactly as the design says.
 */

// ---------------------------------------------------------------- identity

export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [k: string]: Json };

/**
 * Structural identity, total over the value. The repo's own
 * `structuralIdentity` is the model: it walks EVERY own key in sorted order,
 * deliberately not a field list, because an exclusion is a silent-staleness
 * bug — DVC #11079 shipped exactly that (a param excluded from the stage hash,
 * so changing it did not re-run the stage, and "the failure is silent").
 */
export function structural(value: Json): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
    case 'number':
      return String(value);
    case 'string':
      return JSON.stringify(value);
    default:
      break;
  }
  if (Array.isArray(value)) return `[${value.map(structural).join(',')}]`;
  const rec = value as { readonly [k: string]: Json };
  return `{${Object.keys(rec)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${structural(rec[k] as Json)}`)
    .join(',')}}`;
}

// ------------------------------------------------------------------ kinds

/** Six kinds. Five are the game's irreducible facts; ADVICE is the product's. */
export type JointKind = 'model' | 'value' | 'reduction' | 'action' | 'economy' | 'advice';

/** The composition law a kind's members obey. Named, because "how do these
 * combine" must be answered once per joint and not re-decided per consumer. */
export type CompositionLaw =
  | 'lattice-join' // model: weakening only; credal sets join
  | 'mobius' // value: disjoint scopes add, overlaps emit residuals
  | 'choose-one' // reduction: one per site class; averaging composes no guarantee
  | 'ordered-sum' // action: additive over the currency + derived cliff band
  | 'partition' // economy/allocation: shares sum to <= 1
  | 'deadline-meet' // economy/obligation: the tightest binds; kernel pin is bottom
  | 'submodular-budget'; // advice: monotone submodular under attention budget

export type JointId = string;
export type MemberId = string;
export type DataId = string;
export type FitId = string;

// ------------------------------------------------------------ coordinates

/** The premise index. Four groups; the observable group's second component is
 * "what the computation did" (frame + admission + conditioning + selections). */
export interface Premise {
  readonly support: Json; // model/replies/pins
  readonly observable: Json; // horizon + provenance-of-computation
  readonly measure: Json; // quantifier or weight id (+ epsilon at the read)
  readonly config: Json; // botId, codeRef, seat, budget regime, opponents
}

export type CoordinateGroup = keyof Premise;

/** A coordinate's transfer rule: how far apart are two premise values, and what
 * does that cost a fitted number read across the gap. GENERATED from this
 * table, never computed by a member. */
export interface CoordinateRule {
  readonly group: CoordinateGroup;
  readonly path: string; // 'config.opponents'
  readonly penalty: (fit: Json, live: Json) => number; // variance added
}

// ---------------------------------------------------------------- members

export interface FitProvenance {
  readonly fitId: FitId;
  readonly corpus: string;
  readonly population: ReadonlyArray<{ readonly codeRef: string; readonly botId: string }>;
  readonly shapes: ReadonlyArray<string>;
  readonly regime: { readonly budgetMs: number; readonly workers: number; readonly turnLimit: number | null };
  readonly metric: MemberId; // the scoring functional IS a member id
  readonly n: number;
  readonly residualSigma: number;
  readonly heldOut: ReadonlyArray<{ readonly codeRef: string; readonly botId: string }>;
  /** Identifiability, for scoped/k-additive terms: the parameter count at this
   * arity and whether the design could identify it. A rank-deficient fit is
   * refused at registration — an unidentifiable term absorbs noise. */
  readonly identifiability?: { readonly params: number; readonly rankDeficient: boolean };
}

export interface Member {
  readonly id: MemberId;
  readonly joint: JointId;
  readonly params: Json;
  readonly primitive: string; // the kernel mechanism that interprets params
  readonly soundness: 'advisory' | 'sound-writing';
  /** Declared reads: premise coordinates and shared data entries. Law D
   * delivers exactly these; the ambiguity check reads them. */
  readonly reads: ReadonlyArray<string>; // 'observable.frame', 'data/cost-profile@3'
  readonly writes: ReadonlyArray<string>;
  /** Law M: a member with internal structure declares its parts, and
   * engagement counts per part. */
  readonly parts?: ReadonlyArray<MemberId>;
  readonly fit?: FitProvenance;
  /** Law R waiver: passes reachability only while `blockedBy` holds. */
  readonly engagementWaiver?: { readonly blockedBy: string; readonly check: MemberId };
  /** VALUE only: the participant scope this contribution is denominated over.
   * Empty = board-level. Residual form (Mobius), arity capped by the manifest. */
  readonly scope?: ReadonlyArray<string>;
}

/** Shared fitted data. Not a member: composes with nothing, selected by nobody,
 * read by members that name it. Reachability applies; readers pin the version. */
export interface DataEntry {
  readonly id: DataId;
  readonly provenance: FitProvenance;
  readonly compose: 'refuse';
}

// ----------------------------------------------------------------- joints

export interface ReductionSite {
  readonly site: string; // 'staging/floor' | 'read/root-est' | 'thread/interior' | 'ponder/target'
  readonly constraint: 'kernel-pinned' | 'ruling-13' | 'free';
}

export interface Joint {
  readonly id: JointId;
  readonly kind: JointKind;
  readonly law: CompositionLaw;
  /** May a bot vary this joint WITHIN one decision (Law S)? */
  readonly allowsDynamic: boolean;
  /** VALUE only: the k in k-additive, set by what the corpus can identify. */
  readonly maxScopeArity?: number;
  /** REDUCTION only: the site-class table with its constraint column. */
  readonly sites?: ReadonlyArray<ReductionSite>;
  /** Validate one member's params. Replaces every hand-written key set. */
  readonly codec: (params: Json) => string | null; // null = ok, else the error
}

/** Cross-joint interactions that no single law can express. Data, checked at
 * load AND at experiment-spec generation. */
export interface JointConstraint {
  readonly kind: 'compensating' | 'pinned' | 'requires' | 'excludes';
  readonly joints: ReadonlyArray<string>;
  readonly rule: string;
}

export interface Manifest {
  readonly joints: ReadonlyArray<Joint>;
  readonly constraints: ReadonlyArray<JointConstraint>;
  readonly coordinates: ReadonlyArray<CoordinateRule>;
}

// ---------------------------------------------------------------- choices

export type Transport = 'invariant' | 're-evaluate' | { readonly expires: number };

export type Choice =
  | { readonly at: 'fixed'; readonly member: MemberId }
  | { readonly at: 'composed'; readonly of: ReadonlyArray<Choice> }
  | {
      readonly at: 'conditional';
      readonly on: MemberId;
      readonly then: Choice;
      readonly else: Choice;
      readonly transport: Transport;
    }
  | {
      readonly at: 'priced';
      readonly by: MemberId;
      readonly over: ReadonlyArray<MemberId>;
      readonly transport: Transport;
    };

/** A bot: TOTAL over the manifest's joints. No `??`, no second channel. */
export type Bot = { readonly [joint: string]: Choice };

/** A roster file: a diff expression over a named base. Law N — data only:
 * literals, member ids and the four Choice forms. No interpolation, no
 * expressions, no references between joints. */
export interface BotSpec {
  readonly name: string;
  readonly extends?: string;
  readonly bind: { readonly [joint: string]: Choice };
  /** An instrument exists to bracket a measurement, not to keep a member alive;
   * it must still name why. */
  readonly instrument?: string;
}

// ---------------------------------------------------------- normalisation

export class ManifestError extends Error {}

/**
 * Resolve `extends`, materialise defaults, order canonically. Hydra's `_self_`
 * fiasco is the lesson: composition order must be defined once, and the
 * ARTIFACT is the composed result — not the expression that produced it.
 */
export function normalise(
  spec: BotSpec,
  manifest: Manifest,
  roster: ReadonlyMap<string, BotSpec>,
  defaults: ReadonlyMap<JointId, Choice>
): Bot {
  const chain: BotSpec[] = [];
  let cursor: BotSpec | undefined = spec;
  const seen = new Set<string>();
  while (cursor !== undefined) {
    if (seen.has(cursor.name)) throw new ManifestError(`extends cycle at ${cursor.name}`);
    seen.add(cursor.name);
    chain.unshift(cursor);
    cursor = cursor.extends === undefined ? undefined : roster.get(cursor.extends);
  }
  const out: Record<string, Choice> = {};
  for (const joint of manifest.joints) {
    const fallback = defaults.get(joint.id);
    if (fallback === undefined) throw new ManifestError(`no default for joint ${joint.id}`);
    out[joint.id] = fallback;
  }
  for (const layer of chain) {
    for (const [jointId, choice] of Object.entries(layer.bind)) {
      if (!manifest.joints.some((j) => j.id === jointId)) {
        throw new ManifestError(`bot "${layer.name}" binds unknown joint "${jointId}"`);
      }
      out[jointId] = choice;
    }
  }
  return out;
}

/** Identity: what we asked for. Input-addressed, so it moves on any config
 * change — including ones that change no decision (see behaviourId). */
export function botId(bot: Bot): string {
  return structural(bot as unknown as Json).length === 0
    ? 'empty'
    : hash(structural(bot as unknown as Json));
}

/** Equivalence: what it DOES, over a canonical probe suite. Nix's early cutoff:
 * a change that moves botId but not behaviourId retains prior measurements. */
export function behaviourId(probeOutputs: ReadonlyArray<Json>): string {
  return hash(structural(probeOutputs as unknown as Json));
}

/**
 * THE THIRD IDENTITY (Law I). A NAME is structural and content-free, and it
 * must NOT change across the revisions we want reuse across — the opposite law
 * from a content hash. Names find; hashes validate.
 *
 * Named things are computation sites and carried objects — a line, a cluster, a
 * commitment, an attention row — never values. A value with a name is how a
 * dead number crosses `advance` wearing an identity.
 */
export type Name = string;

export const lineName = (citedUnits: ReadonlyArray<number>, relativePlan: string): Name =>
  `line/${[...citedUnits].sort((a, b) => a - b).join('.')}:${relativePlan}`;

/**
 * A non-deep trace: the hashes of what was read, and of what came out. If every
 * read still hashes the same, the result is reusable whatever else changed —
 * this is what makes invalidation SHORT rather than merely narrow.
 */
export interface TraceRecord {
  readonly reads: ReadonlyArray<{ readonly coordinate: string; readonly valueHash: string }>;
  readonly resultHash: string;
}

/** Search-map / memo validity: the name found the candidate, the trace decides
 * whether it still applies. Recorded at seams only, never per comparator call. */
export function traceValid(
  trace: TraceRecord,
  live: (coordinate: string) => string | undefined
): boolean {
  for (const read of trace.reads) {
    if (live(read.coordinate) !== read.valueHash) return false;
  }
  return true;
}

/**
 * EDGE-CREDITED SPEND. A shared sub-result is consumed by several branches, so
 * cost attaches to the EDGE and not the node: a partition over nodes would let
 * free-riders look cheap and would misprice the next VOI comparison. Local
 * compilation optimality (Zilberstein) assumes a tree and is deliberately
 * dropped here — sharing is worth more than the theorem, and the loss is
 * recorded rather than hidden.
 */
export interface EdgeCredit {
  readonly consumer: Name;
  readonly subResult: Name;
  readonly quanta: number;
}

export function creditSpend(subResult: Name, consumers: ReadonlyArray<Name>, quanta: number): ReadonlyArray<EdgeCredit> {
  if (consumers.length === 0) return [];
  const share = quanta / consumers.length;
  return consumers.map((consumer) => ({ consumer, subResult, quanta: share }));
}

/** A tiny stable digest — the real one is sha256; this keeps the sketch free of
 * imports so it compiles alone. */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 2654435761) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------- diff

export interface JointDiff {
  readonly joint: JointId;
  readonly a: string;
  readonly b: string;
}

/** What an arm's treatment claim IS — machine-computed, not prose. */
export function botDiff(a: Bot, b: Bot): ReadonlyArray<JointDiff> {
  const joints = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: JointDiff[] = [];
  for (const joint of [...joints].sort()) {
    const left = structural((a[joint] ?? null) as unknown as Json);
    const right = structural((b[joint] ?? null) as unknown as Json);
    if (left !== right) out.push({ joint, a: left, b: right });
  }
  return out;
}

// ----------------------------------------------------------------- checks

export interface CheckFinding {
  readonly law: 'R' | 'S' | 'N' | 'ambiguity' | 'constraint' | 'codec';
  readonly detail: string;
}

/** Every member a choice can reach, transitively through its declared reads. */
export function reachable(bot: Bot, members: ReadonlyMap<MemberId, Member>): Set<MemberId> {
  const out = new Set<MemberId>();
  const visit = (id: MemberId): void => {
    if (out.has(id)) return;
    out.add(id);
    const m = members.get(id);
    if (m === undefined) return;
    for (const part of m.parts ?? []) visit(part);
    for (const read of m.reads) if (members.has(read)) visit(read);
  };
  const walk = (c: Choice): void => {
    switch (c.at) {
      case 'fixed':
        visit(c.member);
        return;
      case 'composed':
        for (const inner of c.of) walk(inner);
        return;
      case 'conditional':
        visit(c.on);
        walk(c.then);
        walk(c.else);
        return;
      case 'priced':
        visit(c.by);
        for (const id of c.over) visit(id);
        return;
    }
  };
  for (const choice of Object.values(bot)) walk(choice);
  return out;
}

const isDynamic = (c: Choice): boolean =>
  c.at === 'priced' ||
  c.at === 'conditional' ||
  (c.at === 'composed' && c.of.some(isDynamic));

/**
 * The three checks, plus the two the prior-art audit added.
 *
 * R  — reachable from a roster bot AND engaged (engagement is a run-time input
 *      here; the waiver's `blockedBy` suspends the requirement).
 * S  — no dynamic choice on a MODEL or REDUCTION joint.
 * ambiguity — Bevy's lesson: report every member pair touching one coordinate
 *      with no declared ordering and no constraint row. Undeclared interactions
 *      must be DETECTED, not discouraged.
 */
export function check(
  manifest: Manifest,
  members: ReadonlyMap<MemberId, Member>,
  roster: ReadonlyArray<Bot>,
  engaged: ReadonlySet<MemberId>,
  blocked: ReadonlySet<string>
): ReadonlyArray<CheckFinding> {
  const findings: CheckFinding[] = [];
  const jointOf = new Map(manifest.joints.map((j) => [j.id, j]));

  // Law S, and the codec, per bound choice.
  for (const bot of roster) {
    for (const [jointId, choice] of Object.entries(bot)) {
      const joint = jointOf.get(jointId);
      if (joint === undefined) continue;
      if (isDynamic(choice) && !joint.allowsDynamic) {
        findings.push({
          law: 'S',
          detail: `${jointId} (${joint.kind}) may not be chosen dynamically`,
        });
      }
    }
  }
  for (const member of members.values()) {
    const joint = jointOf.get(member.joint);
    if (joint === undefined) {
      findings.push({ law: 'codec', detail: `${member.id} names unknown joint ${member.joint}` });
      continue;
    }
    const err = joint.codec(member.params);
    if (err !== null) findings.push({ law: 'codec', detail: `${member.id}: ${err}` });
    if (joint.maxScopeArity !== undefined && (member.scope?.length ?? 0) > joint.maxScopeArity) {
      findings.push({
        law: 'codec',
        detail: `${member.id} scope arity ${member.scope?.length} exceeds ${joint.maxScopeArity}`,
      });
    }
    if (member.fit?.identifiability?.rankDeficient === true) {
      findings.push({ law: 'codec', detail: `${member.id}: fit is rank-deficient at this arity` });
    }
  }

  // Law R, both clauses.
  const live = new Set<MemberId>();
  for (const bot of roster) for (const id of reachable(bot, members)) live.add(id);
  for (const member of members.values()) {
    if (!live.has(member.id)) {
      findings.push({ law: 'R', detail: `${member.id} is reachable from no roster bot` });
      continue;
    }
    const waived = member.engagementWaiver !== undefined && blocked.has(member.engagementWaiver.blockedBy);
    if (!engaged.has(member.id) && !waived) {
      findings.push({ law: 'R', detail: `${member.id} never engaged in a validated run` });
    }
  }

  // Ambiguity: two members of DIFFERENT joints touching one coordinate, where
  // at least one writes, and no constraint row covers the pair.
  //
  // WITHIN one joint there is no ambiguity to report: the joint's composition
  // law IS the declared ordering, which is the whole point of having one. That
  // refinement came out of running this sketch — the first version flagged two
  // evaluators writing the same fold, which is exactly what `mobius` says they
  // do. Bevy's detector has the same shape and the same need for a discharge
  // rule, or the report is noise and gets muted, which is worse than absent.
  const covered = new Set(
    manifest.constraints.flatMap((c) =>
      c.joints.flatMap((x) => c.joints.map((y) => [x.split('#')[0], y.split('#')[0]].sort().join('|')))
    )
  );
  const seen = new Set<string>();
  for (const a of members.values()) {
    for (const b of members.values()) {
      if (a.id >= b.id) continue;
      if (a.joint === b.joint) continue;
      const shared = a.writes.filter((w) => b.reads.includes(w) || b.writes.includes(w));
      if (shared.length === 0) continue;
      const pair = [a.joint, b.joint].sort().join('|');
      if (covered.has(pair)) continue;
      if (seen.has(pair)) continue;
      seen.add(pair);
      findings.push({
        law: 'ambiguity',
        detail: `${a.id} writes ${shared.join(',')} also touched by ${b.id} (${b.joint}), and no constraint row covers ${pair}`,
      });
    }
  }

  return findings;
}

/**
 * The transfer penalty, GENERATED from the two premise records. A member never
 * computes this: member-local code that is wrong about its own semantics is the
 * defect class this rule exists to remove.
 */
export function transferVariance(
  manifest: Manifest,
  fit: Premise,
  live: Premise
): { readonly sigma2: number; readonly byCoordinate: ReadonlyArray<{ path: string; add: number }> } {
  const by: Array<{ path: string; add: number }> = [];
  let total = 0;
  for (const rule of manifest.coordinates) {
    const add = rule.penalty(fit[rule.group], live[rule.group]);
    if (add !== 0) by.push({ path: rule.path, add });
    total += add;
  }
  return { sigma2: total, byCoordinate: by };
}

/** Earned precision, with the fit's own residual and the transfer penalty. A
 * number with no provenance claims no precision at all. */
export function advisoryPrecision(fit: FitProvenance | undefined, sigma2Transfer: number): number {
  if (fit === undefined) return 0;
  const variance = fit.residualSigma * fit.residualSigma + sigma2Transfer;
  return variance <= 0 ? 0 : 1 / variance;
}
