import type { PlatformAccount } from "@/models/platformAccount";
import type { useUserStore } from "@/stores/userStore";
import type { AccountEditFormState } from "./accountEditFormState";

export interface AccountEditDialogProps {
  open: boolean;
  account?: PlatformAccount;
  readonly?: boolean;
  /** 管理端：目标用户 id，配合 allowMultiplyEdit */
  adminTargetUserId?: string;
  allowMultiplyEdit?: boolean;
  previewForm?: AccountEditFormState;
  previewProxyOptions?: { label: string; value: number }[];
  zIndex?: number;
}

export interface AccountEditContext {
  /** Always read the current form: the panel's v-model can replace the object. */
  readonly form: AccountEditFormState;
  props: AccountEditDialogProps;
  userStore: Pick<ReturnType<typeof useUserStore>, "userId">;
}

export interface AccountEditEmit {
  (event: "close"): void;
  (event: "multiplySaved", multiply: number): void;
}
