const CONCURRENCY = 3;
const MAX_QUEUED = 12;
let active = 0;
const waiters: Array<(acquired: boolean) => void> = [];

export function clearPodPrefetchQueue() {
  for (const resolve of waiters.splice(0))
    resolve(false);
}

export async function runPodPrefetch<T>(work: () => Promise<T>, submitBefore = Infinity): Promise<T | undefined> {
  if (Date.now() >= submitBefore)
    return undefined;
  if (active >= CONCURRENCY) {
    if (waiters.length >= MAX_QUEUED)
      return undefined;
    if (!await new Promise<boolean>(resolve => waiters.push(resolve)))
      return undefined;
  }
  else {
    active += 1;
  }
  try {
    if (Date.now() >= submitBefore)
      return undefined;
    return await work();
  }
  finally {
    const next = waiters.shift();
    if (next)
      next(true);
    else
      active -= 1;
  }
}
