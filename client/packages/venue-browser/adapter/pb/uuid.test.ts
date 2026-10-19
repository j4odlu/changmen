import { afterEach, describe, expect, test, vi } from "vitest";
import { pbUuid } from "./uuid";

describe("pbUuid parity (A8 pt.uuid)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("matches A8 template replace with Math.random() = 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pbUuid()).toBe("88888888-8888-4888-8888-888888888888");
  });

  test("variant nibble uses (s & 3) | 8 branch", () => {
    // 0.4375 * 16 = 7 -> (7 & 3) | 8 = 11 -> "b"
    vi.spyOn(Math, "random").mockReturnValue(0.4375);
    expect(pbUuid()).toBe("bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb");
  });

  test('mode "N" strips dashes like A8 pt.uuid("N")', () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pbUuid("N")).toBe("88888888888848888888888888888888");
  });

  test("default output matches uuid segment layout", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pbUuid()).toMatch(
      /^[89ab]{8}-[89ab]{4}-4[89ab]{3}-[89ab]{4}-[89ab]{12}$/,
    );
  });
});
