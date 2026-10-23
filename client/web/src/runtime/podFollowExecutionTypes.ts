import type { PodYaboFollowScore } from "./podYabo/score";
import type { PodFixtureMatch } from "./podFixtureMatch";
import type { PodMarketMatch, PodObQuoteCompare } from "./podMarketMatch";
import type { FootballFollowSelectionShadow } from "./footballFollowSelectionKey";
import type { FootballFollowShadowCompare } from "./footballFollowShadowCompare";

/** [changmen 扩展] 面板生成的现有跟单票；执行器只消费，不重新匹配或计算报价。 */
export type PodFollowExecutionTicket = PodYaboFollowScore & {
  fixtureMatch: PodFixtureMatch;
  pmFixtureMatch: PodFixtureMatch;
  pmMarketMatch: PodMarketMatch;
  pmQuote: PodObQuoteCompare;
  rayFixtureMatch: PodFixtureMatch;
  rayMarketMatch: PodMarketMatch;
  rayQuote: PodObQuoteCompare;
  selectionShadow: FootballFollowSelectionShadow;
  shadowCompare: FootballFollowShadowCompare;
};

export type PodFollowCell<T> = { value: T };
export type PodFollowReader<T> = Readonly<PodFollowCell<T>>;
