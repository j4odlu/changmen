import type { PodBetSettings } from "./podBetSettings";
import type { PodFollowPlaceTicket } from "./podFollowPlace";
import type { PodPmFollowPlaceTicket } from "./podPmFollowPlace";
import type { PodRayFollowPlaceTicket } from "./podRayFollowPlace";
import type { PodFollowExecutionTicket, PodFollowReader } from "./podFollowExecutionTypes";
import { resolvePodYaboStake } from "./podYabo";

export function createPodFollowPayload(betSettings: PodFollowReader<PodBetSettings>) {
  function followStakeFor(venue: "OB" | "Polymarket" | "RAY"): number {
    return Number(venue === "OB" ? betSettings.value.obStake : venue === "RAY" ? betSettings.value.rayStake : betSettings.value.pmStake) || 0;
  }

  function strategyStakeFor(venue: "OB" | "Polymarket" | "RAY", auto: boolean): number {
    const base = followStakeFor(venue);
    return auto ? resolvePodYaboStake(base, betSettings.value) : base;
  }

  function ticketPlacePayload(ticket: PodFollowExecutionTicket, auto = false): PodFollowPlaceTicket {
    const hit = ticket.fixtureMatch.status === "matched" ? ticket.fixtureMatch.hits[0] : null;
    return {
      id: ticket.id,
      stake: strategyStakeFor("OB", auto),
      fixtureStatus: ticket.fixtureMatch.status,
      fixtureBasis: ticket.fixtureMatch.basis,
      obMid: String(hit?.fixture.obMid || "").trim(),
      home: ticket.alert.home,
      away: ticket.alert.away,
      sideLabel: ticket.sideLabel,
      marketLabel: ticket.marketLabel,
      auto,
      submitBefore: auto ? Math.min(
        betSettings.value.maxAgeSec > 0 ? ticket.alert.alertedAt + betSettings.value.maxAgeSec * 1000 : Infinity,
        betSettings.value.prematchOnly ? ticket.alert.starts : Infinity,
      ) : undefined,
      accountIds: betSettings.value.followAccountIds,
      market: ticket.marketMatch,
      quote: ticket.obQuote,
    };
  }

  function pmTicketPlacePayload(ticket: PodFollowExecutionTicket, auto = false): PodPmFollowPlaceTicket {
    const hit = ticket.pmFixtureMatch.status === "matched" ? ticket.pmFixtureMatch.hits[0] : null;
    return {
      id: ticket.id,
      stake: strategyStakeFor("Polymarket", auto),
      fixtureStatus: ticket.pmFixtureMatch.status,
      fixtureBasis: ticket.pmFixtureMatch.basis,
      pmMatchId: String(hit?.fixture.pmMid || hit?.fixture.id || "").trim(),
      home: ticket.alert.home,
      away: ticket.alert.away,
      sideLabel: ticket.sideLabel,
      marketLabel: ticket.marketLabel,
      auto,
      accountIds: betSettings.value.pmFollowAccountIds,
      market: ticket.pmMarketMatch,
      quote: ticket.pmQuote,
    };
  }

  function rayTicketPlacePayload(ticket: PodFollowExecutionTicket, auto = false): PodRayFollowPlaceTicket {
    const hit = ticket.rayFixtureMatch.status === "matched" ? ticket.rayFixtureMatch.hits[0] : null;
    return { id: ticket.id, stake: strategyStakeFor("RAY", auto), fixtureStatus: ticket.rayFixtureMatch.status,
      fixtureBasis: ticket.rayFixtureMatch.basis, rayMatchId: String(hit?.fixture.providers?.RAY || ""),
      home: ticket.alert.home, away: ticket.alert.away, sideLabel: ticket.sideLabel, marketLabel: ticket.marketLabel,
      auto, submitBefore: auto ? Math.min(
        betSettings.value.maxAgeSec > 0 ? ticket.alert.alertedAt + betSettings.value.maxAgeSec * 1000 : Infinity,
        betSettings.value.prematchOnly ? ticket.alert.starts : Infinity,
      ) : undefined,
      accountIds: betSettings.value.rayFollowAccountIds, market: ticket.rayMarketMatch, quote: ticket.rayQuote };
  }

  return { followStakeFor, strategyStakeFor, ticketPlacePayload, pmTicketPlacePayload, rayTicketPlacePayload };
}

export type PodFollowPayload = ReturnType<typeof createPodFollowPayload>;
