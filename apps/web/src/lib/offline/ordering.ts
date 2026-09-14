/**
 * Outbox ordering (doc 10 §3).
 *
 * Extracted as a pure function so the rule can be exercised exhaustively
 * without IndexedDB. This is the subtlest logic in the sync engine, and the
 * consequences of getting it wrong are silent: a record sent before its parent
 * gets a 404, which the retry loop then treats as a permanent failure.
 */

export interface Orderable {
  id: string;
  monotonicSeq: number;
  dependsOn: string[];
}

export interface OrderingInput<T extends Orderable> {
  /** Entries eligible to send now (PENDING, past any backoff). */
  candidates: readonly T[];
  /** Ids already accepted by the server. */
  synced: ReadonlySet<string>;
  limit: number;
}

/**
 * Entries in dependency order, capped at `limit`.
 *
 * Rules, in order of importance:
 *
 *  1. An entry never precedes a dependency that is ALSO waiting to send.
 *  2. A dependency already synced is satisfied.
 *  3. A dependency that is neither synced nor waiting is treated as satisfied —
 *     it was pruned, or belongs to another device. Blocking forever on a
 *     reference that will never appear would strand the record silently.
 *  4. Within those constraints, monotonic sequence order is preserved, so the
 *     order a person worked in is the order the server sees.
 *  5. A cycle cannot arise from this app's writes. If one ever did, the
 *     involved entries are held back rather than sent in an arbitrary order —
 *     visible as a stuck queue, which is diagnosable, rather than as corrupt
 *     ordering, which is not.
 */
export function orderForSend<T extends Orderable>({ candidates, synced, limit }: OrderingInput<T>): T[] {
  const waiting = new Set(candidates.map((entry) => entry.id));
  const bySequence = [...candidates].sort((a, b) => a.monotonicSeq - b.monotonicSeq);

  const ordered: T[] = [];
  const emitted = new Set<string>();

  const satisfied = (dependency: string): boolean =>
    synced.has(dependency) || emitted.has(dependency) || !waiting.has(dependency);

  let progressed = true;
  while (progressed && ordered.length < limit) {
    progressed = false;

    for (const entry of bySequence) {
      if (emitted.has(entry.id)) continue;
      if (!entry.dependsOn.every(satisfied)) continue;

      ordered.push(entry);
      emitted.add(entry.id);
      progressed = true;

      if (ordered.length >= limit) break;
    }
  }

  return ordered;
}
