// Erasure requests (PRD §5d): plan with tombstones at request time (D-018), a per-system task state machine on an
// outbox, and a request status against a clock that never pauses (D-019). Every downstream system is a mock.
import { identifierHash, normalizeIdentifier } from './identity';
import { factValue, knownAt, replay } from './ledger';
import { selectRuleSet } from './ruleset';
import type { Actor, Config, ConsentEvent, EventDraft, FanoutPolicy } from './schema';
import { SECONDS_PER_DAY, addSeconds, toEpoch, fromEpoch } from './time';

export type TaskState = 'PENDING' | 'SENT' | 'RETRY_WAIT' | 'ACKED' | 'DEAD';
export type Task = {
  system: string;
  state: TaskState;
  attempts: number;
  requeues: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  acked_at: string | null;
};
export type TaskEvent = { type: 'ATTEMPT' | 'ACK' | 'NACK' | 'REQUEUE'; at: string; actor?: Actor };
export type Tombstone = { hash: string; channel: string; kid: string; request_id: string; status: 'active' | 'lifted' };

export type ErasurePlan = { eventDraft: EventDraft; tombstones: Tombstone[]; tasks: Task[]; due_at: string };
export type PlanError = 'ERASURE_ALREADY_OPEN' | 'CONTACT_ERASED' | 'NO_RULE_SET_IN_FORCE' | 'BAD_IDENTIFIER';

export function planErasure(args: {
  events: readonly ConsentEvent[];
  config: Config;
  registry: readonly string[];
  identifiers: readonly { channel: string; raw: string }[];
  key: { kid: string; secret: string };
  request: { request_id: string; at: string };
  actor: Actor;
}): { ok: true; plan: ErasurePlan } | { ok: false; error: PlanError } {
  const { request } = args;
  const s = replay(knownAt(args.events, request.at));
  if (s.erasure.completed) return { ok: false, error: 'CONTACT_ERASED' };
  if (s.erasure.requested) return { ok: false, error: 'ERASURE_ALREADY_OPEN' };
  const sel = selectRuleSet(args.config, factValue(s, 'region'), request.at);
  if (!sel.ok) return { ok: false, error: 'NO_RULE_SET_IN_FORCE' };

  const tombstones: Tombstone[] = [];
  for (const id of args.identifiers) {
    const n = normalizeIdentifier(id.channel, id.raw);
    if (!n.ok) return { ok: false, error: 'BAD_IDENTIFIER' };
    tombstones.push({ hash: identifierHash(args.key.secret, id.channel, n.value), channel: id.channel, kid: args.key.kid, request_id: request.request_id, status: 'active' });
  }
  const eventDraft: EventDraft = {
    type: 'ERASURE_REQUESTED',
    channel: null,
    purpose: null,
    occurred_at: request.at,
    recorded_at: request.at,
    source: 'erasure',
    method: 'api',
    evidence_ref: `erasure/${request.request_id}`,
    actor: args.actor,
    verified_channel: null,
  };
  const tasks = args.registry.map(newTask);
  return { ok: true, plan: { eventDraft, tombstones, tasks, due_at: addSeconds(request.at, sel.ruleSet.erasure.sla_days * SECONDS_PER_DAY) } };
}

export function newTask(system: string): Task {
  return { system, state: 'PENDING', attempts: 0, requeues: 0, last_attempt_at: null, next_attempt_at: null, acked_at: null };
}

/** A failed attempt at `failedAt`: retry after the next backoff, or DEAD when the attempts are used up. */
function fail(task: Task, failedAt: number, policy: FanoutPolicy): Task {
  if (task.attempts < policy.max_attempts) {
    return { ...task, state: 'RETRY_WAIT', next_attempt_at: fromEpoch(failedAt + policy.backoff_seconds[task.attempts - 1]!) };
  }
  return { ...task, state: 'DEAD', next_attempt_at: null };
}

/** Applies a due acknowledgement timeout: a SENT task with no ACK by `last_attempt_at + ack_timeout_seconds`. */
export function tick(task: Task, at: string, policy: FanoutPolicy): Task {
  if (task.state !== 'SENT') return task;
  const deadline = toEpoch(task.last_attempt_at!) + policy.ack_timeout_seconds;
  return toEpoch(at) >= deadline ? fail(task, deadline, policy) : task;
}

export type Applied = { ok: true; task: Task; changed: boolean } | { ok: false; error: 'INVALID_TRANSITION'; task: Task };

/** PRD §5d task table. A pure function of (task, event, policy). */
export function applyTaskEvent(task: Task, event: TaskEvent, policy: FanoutPolicy): Applied {
  const invalid = { ok: false as const, error: 'INVALID_TRANSITION' as const, task };
  const t = toEpoch(event.at);
  if (event.type === 'ACK') {
    if (task.state === 'ACKED') return { ok: true, task, changed: false };
    return { ok: true, task: { ...task, state: 'ACKED', acked_at: event.at, next_attempt_at: null }, changed: true };
  }
  if (event.type === 'NACK') {
    if (task.state !== 'SENT') return invalid;
    const deadline = toEpoch(task.last_attempt_at!) + policy.ack_timeout_seconds;
    return { ok: true, task: fail(task, t < deadline ? t : deadline, policy), changed: true };
  }
  const current = tick(task, event.at, policy);
  if (event.type === 'ATTEMPT') {
    const due = current.state === 'PENDING' || (current.state === 'RETRY_WAIT' && t >= toEpoch(current.next_attempt_at!));
    if (!due) return invalid;
    return { ok: true, task: { ...current, state: 'SENT', attempts: current.attempts + 1, last_attempt_at: event.at, next_attempt_at: null }, changed: true };
  }
  // REQUEUE: a person sends a DEAD task back for another round of attempts
  if (current.state !== 'DEAD' || event.actor?.kind !== 'user') return invalid;
  return { ok: true, task: { ...current, state: 'RETRY_WAIT', attempts: 0, requeues: current.requeues + 1, next_attempt_at: event.at }, changed: true };
}

export type RequestStatus = {
  state: 'COMPLETED' | 'BLOCKED' | 'IN_PROGRESS';
  at_risk: boolean;
  overdue: boolean;
  tasks: Task[];
  completed_at?: string;
  completed_late?: boolean;
  eventDraft?: EventDraft;
};

/**
 * Request status at `at` (PRD §5d). Due timeouts are applied first. The completion draft is returned whenever the
 * state is COMPLETED; appending it once is the caller's job.
 */
export function requestStatus(request: { request_id: string; due_at: string }, tasks: readonly Task[], at: string, policy: FanoutPolicy): RequestStatus {
  const ticked = tasks.map((x) => tick(x, at, policy));
  if (ticked.length > 0 && ticked.every((x) => x.state === 'ACKED')) {
    const completedAt = fromEpoch(Math.max(...ticked.map((x) => toEpoch(x.acked_at!))));
    return {
      state: 'COMPLETED',
      at_risk: false,
      overdue: false,
      tasks: ticked,
      completed_at: completedAt,
      completed_late: toEpoch(completedAt) > toEpoch(request.due_at),
      eventDraft: {
        type: 'ERASURE_COMPLETED',
        channel: null,
        purpose: null,
        occurred_at: completedAt,
        recorded_at: at,
        source: 'erasure',
        method: 'system',
        evidence_ref: `erasure/${request.request_id}`,
        actor: { kind: 'system' },
        verified_channel: null,
      },
    };
  }
  const t = toEpoch(at);
  const due = toEpoch(request.due_at);
  return {
    state: ticked.some((x) => x.state === 'DEAD') ? 'BLOCKED' : 'IN_PROGRESS',
    at_risk: t >= due - policy.warn_days * SECONDS_PER_DAY,
    overdue: t > due,
    tasks: ticked,
  };
}
