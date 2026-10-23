import type { AccountEditContext } from "./accountEditContext";
import type { Ref } from "vue";
import type { ObSportAccountEditor } from "./obSportAccountEditor";
import type { PolymarketAccountEditor } from "./polymarketAccountEditor";
import { ElLoading, ElMessage } from "element-plus";
import { prepareObSportAccountForm } from "@/components/account/accountEditFormState";
import { createGatewayProbeAccount, pickFastestGateway } from "@/components/account/accountGatewayProbe";
import { parseSportObSessionInput } from "@/runtime/obSportSessionLocal";
import { isObSportPcShellHost, resolveObSportHttpGateway } from "@/runtime/obSportTrial";
interface AccountCredentialPasteContext extends AccountEditContext {
  pasteRaw: Ref<string>;
  obTokenTab: Ref<"esport" | "sport">;
  sportObForm: ObSportAccountEditor["sportObForm"];
  syncPolymarketFieldsFromToken: PolymarketAccountEditor["syncPolymarketFieldsFromToken"];
  applyPbIdentityFromToken: (token: string | undefined) => void;
}
import {
  isSportObCollectCredential,
  parsePastedAccountCredential,
  parsePastedObject,
} from "@/components/account/accountCredentialParse";

export function createAccountCredentialPaste(ctx: AccountCredentialPasteContext) {
  const { props, pasteRaw, obTokenTab, sportObForm, syncPolymarketFieldsFromToken, applyPbIdentityFromToken } = ctx;

  async function pasteFromClipboard() {
    try {
      pasteRaw.value = await navigator.clipboard.readText();
      await applyPaste();
    }
    catch {
      ElMessage.error("无法访问剪贴板，请检查浏览器权限或手动粘贴！");
    }
  }

  function onPasteQuickFill(ev: ClipboardEvent) {
    const text = ev.clipboardData?.getData("text") || "";
    if (!text.trim())
      return;
    ev.preventDefault();
    pasteRaw.value = text;
    void applyPaste();
  }

  async function applyPaste() {
    if (!pasteRaw.value.trim())
      return;
    let loading: ReturnType<typeof ElLoading.service> | undefined;
    try {
      const raw = pasteRaw.value.trim();
      const sportSession = parseSportObSessionInput(raw);
      if (sportSession.ok) {
        if (props.account?.accountId && props.account.provider !== "OB") {
          ElMessage.error("这是体育 OB token，请添加到 OB 下注账号");
          return;
        }
        prepareObSportAccountForm(ctx.form, !props.account?.accountId);
        obTokenTab.value = "sport";
        sportObForm.token = sportSession.session.token || "";
        const pastedGw = String(sportSession.session.gateway || "").trim();
        const pastedRef = String(sportSession.session.referer || "").trim();
        sportObForm.gateway = resolveObSportHttpGateway(pastedGw, pastedRef)
          || (isObSportPcShellHost(pastedGw) ? "" : pastedGw);
        sportObForm.referer = pastedRef;
        sportObForm.venueMemberId = String(
          sportSession.session.sessionId || sportSession.session.uid || "",
        ).trim();
        sportObForm.venueAccountName = "";
        pasteRaw.value = "";
        ElMessage.success("已识别为体育凭证，并切换到体育页签");
        return;
      }
      const pastedObj = parsePastedObject(raw);
      if (isSportObCollectCredential(pastedObj)) {
        ElMessage.error("已识别为体育凭证，但数据不完整，请检查 Token、网关和会员 UID");
        return;
      }
      const parsed = parsePastedAccountCredential(raw);
      if (!parsed) {
        if (ctx.form.provider === "Stake") {
          ctx.form.token = raw;
          pasteRaw.value = "";
          ElMessage.success("已填入 Stake token");
          return;
        }
        ElMessage.error("解析失败");
        return;
      }
      if (!parsed?.provider) {
        ElMessage({ message: "未选择场馆", type: "error", plain: true });
        return;
      }
      const gateways = Array.isArray(parsed.gateway)
        ? parsed.gateway
        : parsed.gateway
          ? [parsed.gateway]
          : [];
      ctx.form.provider = parsed.provider;
      if (parsed.provider === "OB")
        obTokenTab.value = "esport";
      ctx.form.token = parsed.token ?? "";
      ctx.form.referer = parsed.referer ?? "";
      if (gateways.length)
        ctx.form.gateway = gateways[0]!;
      else if (parsed.provider === "Stake" && !ctx.form.gateway.trim())
        ctx.form.gateway = "https://stake.com";
      syncPolymarketFieldsFromToken(ctx.form.token);
      if (parsed.provider === "PB")
        applyPbIdentityFromToken(ctx.form.token);

      if (gateways.length <= 1) {
        ElMessage.success(parsed.provider === "OB"
          ? "已识别为电竞凭证，并切换到电竞页签"
          : "粘贴成功");
        return;
      }

      loading = ElLoading.service({ fullscreen: true, text: "正在检测最快网关" });
      const gate = await pickFastestGateway(
        gateway => createGatewayProbeAccount({
          provider: parsed.provider!,
          gateway,
          token: parsed.token ?? "",
          referer: parsed.referer ?? "",
          proxyId: ctx.form.proxyId === 0 ? undefined : ctx.form.proxyId,
        }),
        gateways,
        ({ gate, time, success }) => {
          ElMessage({
            message: `${gate}，耗时：${time}ms`,
            type: success ? "success" : "error",
            duration: 3000,
          });
        },
      );
      if (!gate) {
        ElMessage.error("当前网关测试失败");
        ctx.form.gateway = "";
      }
      else {
        ctx.form.gateway = gate;
      }
      ElMessage.success("粘贴成功");
    }
    catch (err) {
      ElMessage.error(err instanceof Error ? err.message : "解析失败");
    }
    finally {
      loading?.close();
      pasteRaw.value = "";
    }
  }

  return { pasteFromClipboard, onPasteQuickFill, applyPaste };
}

export type AccountCredentialPaste = ReturnType<typeof createAccountCredentialPaste>;
