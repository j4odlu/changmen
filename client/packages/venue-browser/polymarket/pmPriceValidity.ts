export function isValidClobPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 1;
}
