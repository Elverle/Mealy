import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CHECK_RETRY_FIRST_DELAY_MS,
  CHECK_RETRY_MAX_DELAY_MS,
  CHECK_SEND_TIMEOUT_MS,
  CheckQueue,
  classifyCheckError,
  createLocalCheckStorage,
  createMemoryCheckStorage,
  type CheckQueueOptions,
} from '@/lib/shopping/check-queue';
import { ApiRequestError } from '@/lib/http/client';

type Send = CheckQueueOptions['send'];

const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PLAN_ID = '22222222-2222-4222-8222-222222222222';
const NETWORK_MESSAGE = 'Connessione non disponibile.';
const NETWORK_ERROR = new ApiRequestError(0, 'network_error', NETWORK_MESSAGE);

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (err: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = (err) => rej(err);
  });
  return { promise, resolve, reject };
}

/** Un invio che non si risolve mai e rigetta solo all'interruzione (limite di tempo o dispose). */
function hangUntilAborted(): Send {
  return (_itemId, _checked, signal) =>
    new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(NETWORK_ERROR));
    });
}

/** Lascia girare le microtask e i timer a delay zero (con timer finti). */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('CheckQueue', () => {
  it('sends a new check at once and keeps it pending until the server answers', async () => {
    const ack = deferred();
    const send = vi.fn<Send>(() => ack.promise);
    const storage = createMemoryCheckStorage();
    const queue = new CheckQueue({ send, storage });

    queue.enqueue(ITEM_ID, true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ITEM_ID, true, expect.any(AbortSignal));
    expect(queue.state).toEqual({ pending: new Map([[ITEM_ID, true]]), stalled: false });
    expect(storage.load()).toEqual({ [ITEM_ID]: true });

    ack.resolve();
    await queue.flush();

    expect(queue.state.pending.size).toBe(0);
    expect(storage.load()).toEqual({});
  });

  it('never has two requests in flight for the same item and sends the latest state after the first', async () => {
    const first = deferred();
    const second = deferred();
    const send = vi
      .fn<Send>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    queue.enqueue(ITEM_ID, false);

    expect(send).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    expect(send.mock.calls).toEqual([
      [ITEM_ID, true, expect.any(AbortSignal)],
      [ITEM_ID, false, expect.any(AbortSignal)],
    ]);

    second.resolve();
    await queue.flush();

    expect(queue.state.pending.size).toBe(0);
  });

  it('sends only the latest state when the item is toggled several times during a send', async () => {
    const first = deferred();
    const send = vi.fn<Send>().mockReturnValueOnce(first.promise);
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    queue.enqueue(ITEM_ID, false);
    queue.enqueue(ITEM_ID, true);

    first.resolve();
    await queue.flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ITEM_ID, true, expect.any(AbortSignal));
    expect(queue.state.pending.size).toBe(0);
  });

  it('sends different items in parallel', async () => {
    const first = deferred();
    const second = deferred();
    const send = vi
      .fn<Send>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    queue.enqueue(OTHER_ID, true);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, ITEM_ID, true, expect.any(AbortSignal));
    expect(send).toHaveBeenNthCalledWith(2, OTHER_ID, true, expect.any(AbortSignal));

    first.resolve();
    second.resolve();
    await queue.flush();

    expect(queue.state.pending.size).toBe(0);
  });
});

describe('CheckQueue retries on network failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the check pending and retries with growing delays capped at the maximum', async () => {
    const send = vi.fn<Send>().mockRejectedValue(NETWORK_ERROR);
    const onChange = vi.fn();
    const onDropped = vi.fn();
    const storage = createMemoryCheckStorage();
    const queue = new CheckQueue({ send, storage, onChange, onDropped });

    queue.enqueue(ITEM_ID, true);
    await settle();

    expect(queue.state).toEqual({ pending: new Map([[ITEM_ID, true]]), stalled: true });
    expect(onChange).toHaveBeenLastCalledWith({
      pending: new Map([[ITEM_ID, true]]),
      stalled: true,
    });
    expect(onDropped).not.toHaveBeenCalled();
    expect(storage.load()).toEqual({ [ITEM_ID]: true });

    const delays = [
      CHECK_RETRY_FIRST_DELAY_MS,
      CHECK_RETRY_FIRST_DELAY_MS * 2,
      CHECK_RETRY_FIRST_DELAY_MS * 4,
      CHECK_RETRY_FIRST_DELAY_MS * 8,
      CHECK_RETRY_MAX_DELAY_MS,
      CHECK_RETRY_MAX_DELAY_MS,
    ];
    let calls = 1;
    for (const delay of delays) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(send).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      calls += 1;
      expect(send).toHaveBeenCalledTimes(calls);
    }

    queue.dispose();
  });

  it('clears stalled and empties the queue when a send succeeds, then restarts the backoff from the first delay', async () => {
    const send = vi
      .fn<Send>()
      .mockRejectedValueOnce(NETWORK_ERROR)
      .mockRejectedValueOnce(NETWORK_ERROR)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(NETWORK_ERROR)
      .mockResolvedValueOnce(undefined);
    const storage = createMemoryCheckStorage();
    const queue = new CheckQueue({ send, storage });

    queue.enqueue(ITEM_ID, true);
    await settle();
    expect(queue.state.stalled).toBe(true);

    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.state.stalled).toBe(true);

    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS * 2);
    expect(send).toHaveBeenCalledTimes(3);
    expect(queue.state).toEqual({ pending: new Map(), stalled: false });
    expect(storage.load()).toEqual({});

    queue.enqueue(ITEM_ID, false);
    await settle();
    expect(queue.state.stalled).toBe(true);
    expect(send).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS - 1);
    expect(send).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(5);
    expect(queue.state).toEqual({ pending: new Map(), stalled: false });
  });

  it('treats a generic error as a network failure and retries it', async () => {
    const send = vi.fn<Send>().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    await settle();

    expect(queue.state.stalled).toBe(true);

    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS);

    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.state.pending.size).toBe(0);
  });

  it('flush waits for the send in flight and resolves only after it ends', async () => {
    const ack = deferred();
    const send = vi.fn<Send>(() => ack.promise);
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    let flushed = false;
    const flushing = queue.flush().then(() => {
      flushed = true;
    });
    await settle();

    expect(flushed).toBe(false);

    ack.resolve();
    await flushing;

    expect(flushed).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flush cancels a pending retry timer and sends at once', async () => {
    const send = vi
      .fn<Send>()
      .mockRejectedValueOnce(NETWORK_ERROR)
      .mockResolvedValueOnce(undefined);
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    await queue.flush();

    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.state.pending.size).toBe(0);

    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS * 2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries a stuck check at once when a send for another item succeeds, without waiting for its timer', async () => {
    let stuckCalls = 0;
    const send = vi.fn<Send>((itemId) => {
      if (itemId !== ITEM_ID) return Promise.resolve();
      stuckCalls += 1;
      return stuckCalls <= 2 ? Promise.reject(NETWORK_ERROR) : Promise.resolve();
    });
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    await settle();
    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS);
    expect(stuckCalls).toBe(2);
    expect(queue.state.stalled).toBe(true);

    queue.enqueue(OTHER_ID, true);
    await settle();

    expect(stuckCalls).toBe(3);
    expect(queue.state).toEqual({ pending: new Map(), stalled: false });
    // Il vecchio timer (4 s) non ha lasciato invii in più.
    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS * 4);
    expect(stuckCalls).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays stalled and backs off again when the immediate retry of a stuck check also fails', async () => {
    let stuckCalls = 0;
    const send = vi.fn<Send>((itemId) => {
      if (itemId !== ITEM_ID) return Promise.resolve();
      stuckCalls += 1;
      return stuckCalls <= 3 ? Promise.reject(NETWORK_ERROR) : Promise.resolve();
    });
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    await settle();
    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS);
    expect(stuckCalls).toBe(2);

    queue.enqueue(OTHER_ID, true);
    await settle();

    expect(stuckCalls).toBe(3);
    expect(queue.state).toEqual({ pending: new Map([[ITEM_ID, true]]), stalled: true });

    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS - 1);
    expect(stuckCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(stuckCalls).toBe(4);
    expect(queue.state).toEqual({ pending: new Map(), stalled: false });
  });

  it('gives up on a send that hangs after CHECK_SEND_TIMEOUT_MS and retries it', async () => {
    const send = vi.fn<Send>(hangUntilAborted());
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    await settle();

    expect(queue.state.stalled).toBe(false);

    await vi.advanceTimersByTimeAsync(CHECK_SEND_TIMEOUT_MS - 1);
    expect(queue.state.stalled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(queue.state).toEqual({ pending: new Map([[ITEM_ID, true]]), stalled: true });
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHECK_RETRY_FIRST_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(2);

    queue.dispose();
  });
});

describe('CheckQueue definitive errors and invalid responses', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [404, 'item_not_found', 'Articolo non trovato.'],
    [409, 'plan_archived', 'Il piano è chiuso.'],
  ])(
    'drops the check after a definitive %i %s and leaves no timer behind',
    async (status, code, message) => {
      const error = new ApiRequestError(status, code, message);
      const send = vi.fn<Send>().mockRejectedValue(error);
      const onDropped = vi.fn();
      const storage = createMemoryCheckStorage();
      const queue = new CheckQueue({ send, storage, onDropped });

      queue.enqueue(ITEM_ID, true);
      await settle();

      expect(queue.state).toEqual({ pending: new Map(), stalled: false });
      expect(onDropped).toHaveBeenCalledWith(ITEM_ID, error);
      expect(vi.getTimerCount()).toBe(0);
      expect(storage.load()).toEqual({});
      expect(send).toHaveBeenCalledTimes(1);
    }
  );

  it('treats a 200 with an unreadable body as applied and does not drop it as an error', async () => {
    const send = vi
      .fn<Send>()
      .mockRejectedValueOnce(new ApiRequestError(200, 'invalid_response', 'Risposta non valida.'));
    const onDropped = vi.fn();
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage(), onDropped });

    queue.enqueue(ITEM_ID, true);
    await settle();

    expect(queue.state).toEqual({ pending: new Map(), stalled: false });
    expect(onDropped).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('CheckQueue restore, dispose and abort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores pending checks from storage without sending them until flush', async () => {
    const storage = createMemoryCheckStorage({ [ITEM_ID]: true });
    const send = vi.fn<Send>(() => Promise.resolve());
    const queue = new CheckQueue({ send, storage });

    expect(queue.state).toEqual({ pending: new Map([[ITEM_ID, true]]), stalled: false });
    expect(send).not.toHaveBeenCalled();

    await queue.flush();

    expect(send).toHaveBeenCalledWith(ITEM_ID, true, expect.any(AbortSignal));
    expect(queue.state.pending.size).toBe(0);
  });

  it('dispose cancels the retry timer and ignores later enqueues', async () => {
    const send = vi.fn<Send>().mockRejectedValue(NETWORK_ERROR);
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage() });

    queue.enqueue(ITEM_ID, true);
    await settle();

    queue.dispose();

    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(CHECK_RETRY_MAX_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);

    queue.enqueue(ITEM_ID, false);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not notify after dispose when an in-flight send settles', async () => {
    const ack = deferred();
    const send = vi.fn<Send>(() => ack.promise);
    const onChange = vi.fn();
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage(), onChange });

    queue.enqueue(ITEM_ID, true);
    const callsBeforeDispose = onChange.mock.calls.length;

    queue.dispose();
    ack.resolve();
    await settle();

    expect(onChange).toHaveBeenCalledTimes(callsBeforeDispose);
  });

  it('dispose aborts the in-flight send and does not notify afterwards', async () => {
    const send = vi.fn<Send>(hangUntilAborted());
    const onChange = vi.fn();
    const queue = new CheckQueue({ send, storage: createMemoryCheckStorage(), onChange });

    queue.enqueue(ITEM_ID, true);
    const signal = send.mock.calls[0][2];
    const callsBeforeDispose = onChange.mock.calls.length;

    queue.dispose();
    await settle();

    expect(signal.aborted).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(callsBeforeDispose);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('classifyCheckError', () => {
  it.each([0, 408, 429, 500, 503])('retries status %i', (status) => {
    expect(classifyCheckError(new ApiRequestError(status, 'x', 'x'))).toBe('retry');
  });

  it.each([400, 404, 409, 422])('drops status %i', (status) => {
    expect(classifyCheckError(new ApiRequestError(status, 'x', 'x'))).toBe('drop');
  });

  it('treats a 2xx status as done', () => {
    expect(classifyCheckError(new ApiRequestError(200, 'invalid_response', 'x'))).toBe('done');
  });

  it('retries anything that is not an ApiRequestError', () => {
    expect(classifyCheckError(new Error('x'))).toBe('retry');
  });
});

describe('createLocalCheckStorage', () => {
  const KEY = `mealy:shopping:pending:${PLAN_ID}`;

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('saves and loads the same pending checks under a key per plan', () => {
    const storage = createLocalCheckStorage(PLAN_ID);

    storage.save({ [ITEM_ID]: true, [OTHER_ID]: false });

    expect(storage.load()).toEqual({ [ITEM_ID]: true, [OTHER_ID]: false });
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')).toEqual({
      [ITEM_ID]: true,
      [OTHER_ID]: false,
    });
    expect(createLocalCheckStorage(OTHER_PLAN_ID).load()).toEqual({});
  });

  it('removes the key when saving an empty queue', () => {
    const storage = createLocalCheckStorage(PLAN_ID);
    storage.save({ [ITEM_ID]: true });

    storage.save({});

    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(storage.load()).toEqual({});
  });

  it.each(['boh', '{"a":1}'])('loads an empty queue from a malformed value %s', (raw) => {
    window.localStorage.setItem(KEY, raw);

    expect(createLocalCheckStorage(PLAN_ID).load()).toEqual({});
  });

  it('loads an empty queue and saves silently when localStorage throws', () => {
    const storage = createLocalCheckStorage(PLAN_ID);
    storage.save({ [ITEM_ID]: true });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(storage.load()).toEqual({});
    expect(() => storage.save({ [OTHER_ID]: false })).not.toThrow();
  });
});
