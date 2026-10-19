/**
 * 对齐 A8 `pt.uuid`（PB 唯一请求 id）。
 *
 * [A8 可证实] checkBet / buyV4 使用 `pt.uuid()`；无参返回带连字符的 uuid 串。
 */
export function pbUuid(mode?: "N"): string {
  const r = "generate-uuid-4you-seem-professional".replace(
    /[genratuidyosmpfl]/g,
    (n) => {
      const s = (Math.random() * 16) | 0;
      return (n === "x" ? s : (s & 3) | 8).toString(16);
    },
  );
  if (mode === "N") {
    return r.replace(/-/g, "");
  }
  return r;
}
