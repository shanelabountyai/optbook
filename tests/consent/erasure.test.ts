import { describe, expect, it } from 'vitest';
import { decide } from '../../src/lib/consent/decide';
import { applyTaskEvent, newTask, planErasure, type Task, type TaskEvent } from '../../src/lib/consent/erasure';
import { CONFIG, decisionCase, erasureSetup, runErasure } from './helpers/golden';
import { SEED, prng } from './oracle/generator';

describe('erasure: golden ER-01 to ER-09 (AC-d1)', () => {
  it.each(runErasure().map((o) => [o.id, o] as const))('%s', (_id, o) => expect(o.ok, JSON.stringify(o.actual)).toBe(true));
});

describe('erasure: rules', () => {
  const { policy, plan } = erasureSetup();
  it('the tombstone hashes are the identity known answers (keyed HMAC, written at request time)', () => {
    expect(plan.tombstones.map((t) => t.channel)).toEqual(['email', 'sms']);
    expect(plan.tombstones[1]!.hash).toBe('79af8db2075c8d79d46afeadc08aed2e439cf25aa70d069d47d353cc3e7528d7');
    expect(plan.tombstones.every((t) => t.status === 'active' && t.request_id === 'er_0001')).toBe(true);
  });
  it('a second request while one is open is refused (ERASURE_ALREADY_OPEN)', () => {
    const events = [...decisionCase('WE-01').input.events, { ...plan.eventDraft, event_id: 'er-e1' }];
    const r = planErasure({ events, config: CONFIG, registry: ['crm_mock'], identifiers: [], key: { kid: 't1', secret: 'k' }, request: { request_id: 'er_2', at: '2026-11-02T00:00:00Z' }, actor: { kind: 'user' } });
    expect(r).toEqual({ ok: false, error: 'ERASURE_ALREADY_OPEN' });
  });
  it('AC-d3: from the second of the request every message is denied, transactional included', () => {
    const events = [...decisionCase('WE-01').input.events, { ...plan.eventDraft, event_id: 'er-e1' }];
    for (const purpose of ['newsletter', 'transactional']) {
      for (const channel of ['email', 'sms']) {
        const d = decide({ at: plan.eventDraft.recorded_at, message: { channel, purpose }, events, recent_sends: [], tombstone_match: false }, CONFIG);
        expect(d.outcome).toBe('deny');
        expect(d.reasons[0]!.code).toBe('ERASURE_IN_PROGRESS');
      }
    }
  });
  it('REQUEUE needs a DEAD task and a user; ACK is accepted from every state', () => {
    const t = newTask('crm_mock');
    expect(applyTaskEvent(t, { type: 'REQUEUE', at: '2026-11-01T00:00:00Z', actor: { kind: 'user' } }, policy)).toMatchObject({ ok: false, error: 'INVALID_TRANSITION' });
    const dead: Task = { ...t, state: 'DEAD', attempts: 6 };
    expect(applyTaskEvent(dead, { type: 'REQUEUE', at: '2026-11-05T00:00:00Z', actor: { kind: 'system' } }, policy).ok).toBe(false);
    expect(applyTaskEvent(dead, { type: 'REQUEUE', at: '2026-11-05T00:00:00Z', actor: { kind: 'user' } }, policy)).toMatchObject({ ok: true, task: { state: 'RETRY_WAIT', attempts: 0, requeues: 1, next_attempt_at: '2026-11-05T00:00:00Z' } });
    for (const state of ['PENDING', 'SENT', 'RETRY_WAIT', 'DEAD'] as const) {
      expect(applyTaskEvent({ ...t, state, last_attempt_at: '2026-11-01T00:00:00Z' }, { type: 'ACK', at: '2026-11-01T00:00:30Z' }, policy)).toMatchObject({ ok: true, task: { state: 'ACKED' } });
    }
  });
  it('a NACK after the timeout fails at the deadline (the earlier of the two)', () => {
    const sent = applyTaskEvent(newTask('crm_mock'), { type: 'ATTEMPT', at: '2026-11-01T00:01:00Z' }, policy);
    if (!sent.ok) throw new Error();
    expect(applyTaskEvent(sent.task, { type: 'NACK', at: '2026-11-01T05:00:00Z' }, policy)).toMatchObject({ ok: true, task: { state: 'RETRY_WAIT', next_attempt_at: '2026-11-01T01:06:00Z' } });
  });
  it('AC-d2: per-task sequences interleaved across tasks in any order give the same final tasks', () => {
    const seqs: Record<string, TaskEvent[]> = {
      a: [{ type: 'ATTEMPT', at: '2026-11-01T00:01:00Z' }, { type: 'NACK', at: '2026-11-01T00:01:05Z' }, { type: 'ATTEMPT', at: '2026-11-01T00:06:05Z' }, { type: 'ACK', at: '2026-11-01T00:07:00Z' }],
      b: [{ type: 'ATTEMPT', at: '2026-11-01T00:01:00Z' }, { type: 'ATTEMPT', at: '2026-11-01T03:00:00Z' }],
      c: [{ type: 'ACK', at: '2026-11-01T00:02:00Z' }, { type: 'ACK', at: '2026-11-01T00:03:00Z' }],
      d: [{ type: 'ATTEMPT', at: '2026-11-01T00:01:00Z' }, { type: 'NACK', at: '2026-11-01T00:02:00Z' }, { type: 'ATTEMPT', at: '2026-11-01T00:05:00Z' }],
    };
    const runAll = (order: [string, TaskEvent][]) => {
      const tasks: Record<string, Task> = Object.fromEntries(Object.keys(seqs).map((s) => [s, newTask(s)]));
      for (const [s, e] of order) tasks[s] = applyTaskEvent(tasks[s]!, e, policy).task;
      return tasks;
    };
    const flat = Object.entries(seqs).flatMap(([s, es]) => es.map((e) => [s, e] as [string, TaskEvent]));
    const base = runAll(flat);
    const r = prng(SEED + 30);
    for (let i = 0; i < 50; i += 1) {
      // a random interleaving that keeps each task's own order
      const queues = Object.fromEntries(Object.entries(seqs).map(([s, es]) => [s, [...es]]));
      const order: [string, TaskEvent][] = [];
      while (Object.values(queues).some((q) => q.length)) {
        const s = r.pick(Object.keys(queues).filter((k) => queues[k]!.length));
        order.push([s, queues[s]!.shift()!]);
      }
      expect(runAll(order)).toEqual(base);
    }
  });
});
