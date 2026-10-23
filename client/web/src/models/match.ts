import type { PlatformId } from "@changmen/api-contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type { UserConfig } from "@/types/userConfig";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { storeQuoteSource } from "@/services/quoteSource";
import { buildOrderOptions } from "@/domain/betting";
import {
  ViewBet,
  ViewBetItem,
  ViewMatch,
  toViewMatches,
  type BetSide,
} from "@changmen/client-core/models/match";

export {
  ViewBet,
  ViewBetItem,
  ViewMatch,
  toViewMatches,
  type BetSide,
};

declare module "@changmen/client-core/models/match" {
  interface ViewBet {
    getOrderOptions(
      match: ViewMatch,
      config: UserConfig,
      accounts?: PlatformAccount[],
      providerKeys?: PlatformId[],
    ): BetOption[] | undefined;
  }
}

ViewBet.prototype.getOrderOptions = function (
  match: ViewMatch,
  config: UserConfig,
  accounts: PlatformAccount[] = [],
  providerKeys: PlatformId[],
): BetOption[] | undefined {
  return buildOrderOptions(this, match, config, accounts, providerKeys, storeQuoteSource);
};
