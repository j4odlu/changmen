// Test fixture only: freeze the unmodified source once per test file. Fault
// overlays stay outside this reader, so every changed/missing case still reaches
// the complete real guard. CLI tests continue to read the live repository.
export function sourceFixture(read) {
  const sources = new Map();
  return file => {
    const key = typeof file === "string" ? file : file.href;
    if (!sources.has(key)) sources.set(key, read(file));
    return sources.get(key);
  };
}
