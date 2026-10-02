/** Node 版本提供的 Web Storage 不一致；单测为两种 storage 提供完整实现。 */
for (const name of ["localStorage", "sessionStorage"] as const) {
  if (typeof globalThis[name]?.getItem === "function")
    continue;
  const mem = new Map();
  globalThis[name] = {
    getItem: key => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => {
      mem.set(String(key), String(value));
    },
    removeItem: key => {
      mem.delete(String(key));
    },
    clear: () => mem.clear(),
    key: index => [...mem.keys()][index] ?? null,
    get length() {
      return mem.size;
    },
  };
}
