import { describe, expect, it } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { createAccountEditFormStateFromPlatformAccount, prepareObSportAccountForm } from "./accountEditFormState";

function makeForm(provider: "Polymarket" | "OB", token = "") {
  return createAccountEditFormStateFromPlatformAccount(new PlatformAccount({
    accountId: 1,
    playerName: "test",
    provider,
    gateway: "https://clob.polymarket.com",
    referer: "https://polymarket.com/zh",
    token,
    cookie: "other-venue-cookie",
    venueMemberId: "other-venue-id",
  }));
}

describe("OB sport credential form", () => {
  it("discards the previous venue session when adding sport credentials", () => {
    const form = makeForm("Polymarket", "other-venue-token");
    prepareObSportAccountForm(form, true);
    expect(form).toMatchObject({ provider: "OB", gateway: "", token: "", referer: "", cookie: "", venueMemberId: "" });
    expect(form.playerName).toBe("test");
  });

  it("cleans defaults on a new OB card without an esport token", () => {
    const form = makeForm("OB");
    form.gateway = "https://other.example.com";
    prepareObSportAccountForm(form, true);
    expect(form.gateway).toBe("");
    expect(form.referer).toBe("");
    expect(form.venueMemberId).toBe("other-venue-id");
  });

  it("preserves an existing OB esport session when adding sport credentials", () => {
    const form = makeForm("OB", "1234567890");
    form.gateway = "https://ob.example.com";
    form.referer = "https://ob.example.com/home";
    const before = { ...form };
    prepareObSportAccountForm(form, false);
    expect(form).toEqual(before);
  });

  it("preserves an existing esport gateway after its token has expired", () => {
    const form = makeForm("OB");
    form.gateway = "https://ob.example.com";
    form.referer = "https://ob.example.com/home";
    const before = { ...form };
    prepareObSportAccountForm(form, false);
    expect(form).toEqual(before);
  });
});
