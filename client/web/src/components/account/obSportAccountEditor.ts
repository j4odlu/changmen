import type { AccountEditContext } from "./accountEditContext";
import type { AccountRecord } from "@changmen/client-core/types/account";
import { reactive } from "vue";
import { PlatformAccount } from "@/models/platformAccount";
import { isCompleteObSportCredential, isObSportBetToken, isObSportMemberId } from "@/runtime/obSportBetAccount";
export function createObSportAccountEditor(ctx: AccountEditContext) {
  const { props } = ctx;
  const sportObForm = reactive({
    token: "",
    gateway: "",
    referer: "",
    venueMemberId: "",
    venueAccountName: "",
  });

  function resetSportObForm(acc?: PlatformAccount) {
    sportObForm.token = "";
    sportObForm.gateway = "";
    sportObForm.referer = "";
    sportObForm.venueMemberId = "";
    sportObForm.venueAccountName = "";
    const nested = acc?.sportOb;
    if (nested?.token) {
      sportObForm.token = String(nested.token || "");
      sportObForm.gateway = String(nested.gateway || "");
      sportObForm.referer = String(nested.referer || "");
      sportObForm.venueMemberId = String(nested.venueMemberId || "");
      sportObForm.venueAccountName = String(nested.venueAccountName || "");
    }
    else if (acc && isObSportBetToken(String(acc.token || ""))) {
      sportObForm.token = String(acc.token || "");
      sportObForm.gateway = String(acc.gateway || "");
      sportObForm.referer = String(acc.referer || "");
      sportObForm.venueMemberId = String(acc.venueMemberId || "");
      sportObForm.venueAccountName = "";
    }
    if (isObSportBetToken(ctx.form.token))
      ctx.form.token = "";
  }

  function sportObFromForm(): AccountRecord["sportOb"] | undefined {
    const token = sportObForm.token.trim();
    if (!isObSportBetToken(token))
      return undefined;
    return {
      token,
      gateway: sportObForm.gateway.trim() || undefined,
      referer: sportObForm.referer.trim() || undefined,
      venueMemberId: sportObForm.venueMemberId.trim() || undefined,
      venueAccountName: sportObForm.venueAccountName.trim() || undefined,
    };
  }

  async function probeObSportCredentialForSave(
    sportOb: NonNullable<AccountRecord["sportOb"]>,
  ): Promise<{ amount: number; venueMemberId: string; venueAccountName: string }> {
    if (!sportOb.gateway)
      throw new Error("体育网关未识别完成，无法保存");
    if (!isObSportMemberId(sportOb.venueMemberId))
      throw new Error("体育账号 UID 无效，无法保存");
    if (!isCompleteObSportCredential(sportOb))
      throw new Error("体育凭证不完整，无法保存");
    const { fetchObSportAmountForAccount } = await import("@/runtime/obSportAmount");
    const {
      assertObSportAccountBinding,
      fetchObSportUserInfoForAccount,
    } = await import("@/runtime/obSportUserInfo");
    try {
      const account = { provider: "OB", sportOb } as const;
      const [amount, identity] = await Promise.all([
        fetchObSportAmountForAccount(account),
        fetchObSportUserInfoForAccount(account),
      ]);
      assertObSportAccountBinding({
        expectedVenueMemberId: sportOb.venueMemberId,
        esportVenueAccountName: props.account?.venueAccountName,
        hasEsportCredential: /^\d{8,}$/.test(String(props.account?.token || "").trim()),
        sport: identity,
      });
      return { amount, ...identity };
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err || "");
      throw new Error(`体育凭证校验失败：${msg || "请检查 Token、网关和 UID"}`);
    }
  }

  return { sportObForm, resetSportObForm, sportObFromForm, probeObSportCredentialForSave };
}

export type ObSportAccountEditor = ReturnType<typeof createObSportAccountEditor>;
