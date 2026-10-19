export type VenueTransportRoutingOptions = {
  ensurePmMarketHub?: boolean;
};

export async function applyVenueTransportRoutingOnLogin(options: VenueTransportRoutingOptions = {}): Promise<void> {
  const ensurePmMarketHub = options.ensurePmMarketHub !== false;
  try {
    const {
      applyPmAutoTransportOnLogin,
      ensurePolymarketMarketQuoteHub,
    } = await import("@changmen/venue-browser/adapter/polymarket");
    const result = await applyPmAutoTransportOnLogin();
    if (ensurePmMarketHub && result.marketWsMode === "official")
      ensurePolymarketMarketQuoteHub();
  }
  catch (err) {
    if (import.meta.env?.DEV)
      console.warn("[PM transport] auto route skipped", err);
  }

  try {
    const { applyPfAutoTransportOnLogin } = await import("@changmen/venue-browser/adapter/predictfun");
    await applyPfAutoTransportOnLogin();
  }
  catch (err) {
    if (import.meta.env?.DEV)
      console.warn("[PF transport] auto route skipped", err);
  }
}

export async function resetVenueTransportRoutingOnLogout(): Promise<void> {
  try {
    const {
      resetPmTransportRoutingOnLogout,
      stopPolymarketMarketQuoteHub,
    } = await import("@changmen/venue-browser/adapter/polymarket");
    stopPolymarketMarketQuoteHub();
    resetPmTransportRoutingOnLogout();
  }
  catch {
    /* ignore */
  }

  try {
    const { resetPfTransportRoutingOnLogout } = await import("@changmen/venue-browser/adapter/predictfun");
    resetPfTransportRoutingOnLogout();
  }
  catch {
    /* ignore */
  }
}
