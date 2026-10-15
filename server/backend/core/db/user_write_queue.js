/** Serialize one user's read/modify/commit/publish sequence; failures do not poison the queue. */
export function createUserWriteQueue() {
  const tails = new Map();
  return function run(userId, task) {
    const key = String(userId);
    const result = (tails.get(key) || Promise.resolve()).then(task);
    const settled = result.then(() => {}, () => {});
    tails.set(key, settled);
    void settled.then(() => {
      if (tails.get(key) === settled)
        tails.delete(key);
    });
    return result;
  };
}
