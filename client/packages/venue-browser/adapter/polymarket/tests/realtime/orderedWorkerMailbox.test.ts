import { useFakeMailboxTasks } from '../helpers/mailboxTasks';
useFakeMailboxTasks();
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { OrderedWorkerMailbox } from '../../realtime/orderedWorkerMailbox';
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
test('100-frame burst preserves order in bounded batches; control messages cannot overtake frames', () => {
  const sent: Array<{ id: number; rows: string[] }> = [], fail = vi.fn();
  const box = new OrderedWorkerMailbox<string>((id, rows) => sent.push({ id, rows }), fail, () => Date.now());
  const input = ['state', ...Array.from({ length: 100 }, (_, i) => `frame${i}`), 'assets', 'begin', 'frame101', 'finish'];
  input.forEach(value => box.enqueue(value, 100)); expect(sent).toHaveLength(0);
  vi.advanceTimersByTime(16); expect(sent).toHaveLength(2); expect(sent.flatMap(x => x.rows)).toEqual(input);
  sent.forEach(x => box.ack(x.id)); expect(box.report().pendingEntries).toBe(0); expect(fail).not.toHaveBeenCalled(); box.stop();
});
test('eight credits retain backpressure; ACK resumes queued entries without loss or unbounded posting', () => {
  const sent: Array<{ id: number; rows: number[] }> = [], fail = vi.fn();
  const box = new OrderedWorkerMailbox<number>((id, rows) => sent.push({ id, rows }), fail, () => Date.now());
  for (let i = 0; i < 1200; i++) box.enqueue(i, 100);
  vi.advanceTimersByTime(16); expect(sent).toHaveLength(8); expect(box.report().queuedEntries).toBe(688);
  for (let round = 0; round < 3; round++) { [...sent].forEach(x => box.ack(x.id)); vi.advanceTimersByTime(16); }
  expect(sent.flatMap(x => x.rows)).toEqual(Array.from({ length: 1200 }, (_, i) => i)); expect(fail).not.toHaveBeenCalled(); box.stop();
});
test.each(['bytes', 'age', 'entries', 'post'])('%s failure is bounded, terminal, and discards all ownership', reason => {
  const fail = vi.fn(), box = new OrderedWorkerMailbox<number>(() => { if (reason === 'post') throw Error('post'); }, fail, () => Date.now());
  if (reason === 'bytes') { box.enqueue(1, 1_000_000); box.enqueue(2, 1_000_001); }
  if (reason === 'entries') for (let i = 0; i < 2049; i++) box.enqueue(i, 1);
  if (reason === 'age') { box.enqueue(1, 1); vi.advanceTimersByTime(1001); box.checkAge(); }
  if (reason === 'post') { box.enqueue(1, 1); vi.advanceTimersByTime(16); }
  expect(fail).toHaveBeenCalledOnce(); expect(box.report()).toMatchObject({ pendingEntries: 0, pendingChars: 0, queuedEntries: 0 });
  expect(box.enqueue(1, 1)).toBe(false); box.ack(1); expect(vi.getTimerCount()).toBe(0);
});

test('stopping with a scheduled flush never posts or revives pending data', () => {
  const post = vi.fn(), box = new OrderedWorkerMailbox(post, vi.fn(), () => Date.now());
  box.enqueue('old', 10); box.stop(); vi.advanceTimersByTime(5000);
  box.ack(1); expect(post).not.toHaveBeenCalled(); expect(box.report().pendingChars).toBe(0);
});

test('timer starvation cannot strand an unsent tail or ACK credit; message tasks retain FIFO and fairness', () => {
  const tasks: Array<() => void> = [], ports: Array<{ closed: boolean }> = [];
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null as (() => void) | null, closed: false, close() { this.closed = true; } };
    port2 = { closed: false, close() { this.closed = true; }, postMessage: () => tasks.push(() => { if (!this.port1.closed) this.port1.onmessage?.(); }) };
    constructor() { ports.push(this.port1, this.port2); }
  });
  let at = 0;
  const sent: Array<{ id: number; rows: number[] }> = [], fail = vi.fn();
  const box = new OrderedWorkerMailbox<number>((id, rows) => sent.push({ id, rows }), fail, () => at);
  // Browser timers never run in this test. Posted message tasks remain runnable.
  for (let i = 0; i < 1200; i++) box.enqueue(i, 10);
  expect(tasks).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  at = 20; tasks.shift()!(); expect(sent).toHaveLength(8); expect(tasks).toHaveLength(0);
  at = 30; for (const batch of [...sent]) box.ack(batch.id);
  expect(tasks).toHaveLength(1); tasks.shift()!();
  at = 40; for (const batch of [...sent]) box.ack(batch.id); tasks.shift()!();
  for (const batch of [...sent]) box.ack(batch.id);
  expect(sent.flatMap(batch => batch.rows)).toEqual(Array.from({ length: 1200 }, (_, i) => i));
  // Later sparse traffic must also wake without timers, rather than awaiting a full batch.
  at = 3000; box.enqueue(1200, 10); expect(tasks).toHaveLength(1); tasks.shift()!(); box.ack(sent.at(-1)!.id);
  expect(box.report()).toMatchObject({ pendingEntries: 0, maxQueueMs: 40, scheduler: 'message-task' });
  expect(fail).not.toHaveBeenCalled(); box.stop(); expect(ports.every(port => port.closed)).toBe(true);
});

test.each(['unsent', 'unacknowledged'])('a genuinely stale %s message still fails at 1000ms with retained stage evidence', stage => {
  let at = 0;
  const fail = vi.fn(), box = new OrderedWorkerMailbox(() => {}, fail, () => at);
  box.enqueue('frame', 616);
  if (stage === 'unacknowledged') { at = 10; vi.advanceTimersByTime(1); }
  at = 1001; expect(box.checkAge()).toBe(false);
  expect(fail).toHaveBeenCalledWith('stream_ack_timeout');
  expect(box.report().failureEvidence).toMatchObject(stage === 'unsent'
    ? { queuedEntries: 1, pendingBatches: 0, oldestQueuedMs: 1001, oldestAckMs: 0 }
    : { queuedEntries: 0, pendingBatches: 1, oldestInflightMs: 1001, oldestAckMs: 991 });
  expect(box.report().pendingEntries).toBe(0); expect(vi.getTimerCount()).toBe(0);
});

test('clone-budget yield schedules one message task and stopping cancels it', () => {
  let at = 0;
  const sent: number[][] = [];
  const box = new OrderedWorkerMailbox<number>((_id, rows) => { sent.push(rows); at += 2; }, vi.fn(), () => at);
  for (let i = 0; i < 200; i++) box.enqueue(i, 1);
  vi.advanceTimersToNextTimer(); expect(sent).toHaveLength(1); expect(sent[0]).toHaveLength(64);
  expect(vi.getTimerCount()).toBe(1); expect(box.report().queuedEntries).toBe(136);
  box.stop(); vi.advanceTimersByTime(5000); expect(sent).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
});
