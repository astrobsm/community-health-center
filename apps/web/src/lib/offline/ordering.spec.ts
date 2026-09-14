import { describe, expect, it } from 'vitest';

import { orderForSend, type Orderable } from './ordering';

const entry = (id: string, monotonicSeq: number, dependsOn: string[] = []): Orderable => ({
  id,
  monotonicSeq,
  dependsOn,
});

const ids = (entries: Orderable[]): string[] => entries.map((e) => e.id);

describe('orderForSend', () => {
  it('preserves the order the assessor actually worked in', () => {
    const candidates = [entry('c', 3), entry('a', 1), entry('b', 2)];

    expect(ids(orderForSend({ candidates, synced: new Set(), limit: 10 }))).toEqual(['a', 'b', 'c']);
  });

  it('never sends a record before a dependency that is also waiting', () => {
    // The answer was captured first, but it belongs to an assessment that has
    // not synced. Sending it first would 404.
    const candidates = [entry('answer', 1, ['assessment']), entry('assessment', 2)];

    expect(ids(orderForSend({ candidates, synced: new Set(), limit: 10 }))).toEqual([
      'assessment',
      'answer',
    ]);
  });

  it('treats an already-synced dependency as satisfied', () => {
    const candidates = [entry('answer', 1, ['assessment'])];

    expect(ids(orderForSend({ candidates, synced: new Set(['assessment']), limit: 10 }))).toEqual([
      'answer',
    ]);
  });

  it('does not block on a dependency that will never appear', () => {
    // Pruned after syncing a week ago, or created on another device. Waiting
    // forever would strand the record with no diagnosable cause.
    const candidates = [entry('answer', 1, ['long-gone'])];

    expect(ids(orderForSend({ candidates, synced: new Set(), limit: 10 }))).toEqual(['answer']);
  });

  it('resolves a chain of dependencies', () => {
    const candidates = [
      entry('photo', 4, ['evidence']),
      entry('evidence', 3, ['assessment']),
      entry('assessment', 1),
      entry('answer', 2, ['assessment']),
    ];

    const order = ids(orderForSend({ candidates, synced: new Set(), limit: 10 }));

    expect(order[0]).toBe('assessment');
    expect(order.indexOf('evidence')).toBeLessThan(order.indexOf('photo'));
    expect(order).toHaveLength(4);
  });

  it('handles several independent chains without interleaving incorrectly', () => {
    const candidates = [
      entry('a2', 2, ['a1']),
      entry('b2', 4, ['b1']),
      entry('a1', 1),
      entry('b1', 3),
    ];

    const order = ids(orderForSend({ candidates, synced: new Set(), limit: 10 }));

    expect(order.indexOf('a1')).toBeLessThan(order.indexOf('a2'));
    expect(order.indexOf('b1')).toBeLessThan(order.indexOf('b2'));
  });

  it('respects the batch limit', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => entry(`e${i}`, i));

    expect(orderForSend({ candidates, synced: new Set(), limit: 10 })).toHaveLength(10);
  });

  it('does not emit a child when the limit cuts off its parent', () => {
    // Sending the child in a later batch is correct; sending it now would 404.
    const candidates = [entry('parent', 1), entry('child', 2, ['parent'])];

    const order = ids(orderForSend({ candidates, synced: new Set(), limit: 1 }));

    expect(order).toEqual(['parent']);
  });

  it('holds back a dependency cycle rather than sending it in a guessed order', () => {
    // Impossible from this app's own writes. If it ever happened, a visibly
    // stuck queue is diagnosable; silently corrupt ordering is not.
    const candidates = [entry('x', 1, ['y']), entry('y', 2, ['x'])];

    expect(orderForSend({ candidates, synced: new Set(), limit: 10 })).toEqual([]);
  });

  it('still sends everything outside a cycle', () => {
    const candidates = [entry('x', 1, ['y']), entry('y', 2, ['x']), entry('fine', 3)];

    expect(ids(orderForSend({ candidates, synced: new Set(), limit: 10 }))).toEqual(['fine']);
  });

  it('returns nothing for an empty queue', () => {
    expect(orderForSend({ candidates: [], synced: new Set(), limit: 10 })).toEqual([]);
  });

  it('is deterministic regardless of input order', () => {
    const candidates = [
      entry('c', 3, ['a']),
      entry('a', 1),
      entry('d', 4, ['b']),
      entry('b', 2, ['a']),
    ];

    const first = ids(orderForSend({ candidates, synced: new Set(), limit: 10 }));
    const second = ids(orderForSend({ candidates: [...candidates].reverse(), synced: new Set(), limit: 10 }));

    expect(first).toEqual(second);
  });
});
