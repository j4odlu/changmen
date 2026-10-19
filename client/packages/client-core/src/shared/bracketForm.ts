/** 对齐 A8 Ma.stringify — 嵌套对象 form-urlencoded */

function appendForm(
  pairs: string[],
  value: unknown,
  key: string,
): void {
  if (value === null || value === undefined) {
    pairs.push(`${encodeURIComponent(key)}=`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      appendForm(pairs, item, `${key}[${index}]`);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendForm(pairs, v, `${key}[${k}]`);
    }
    return;
  }
  pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

export function toBracketForm(body: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    appendForm(pairs, value, key);
  }
  return pairs.join("&");
}
