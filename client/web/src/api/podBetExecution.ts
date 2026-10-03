import { post, unwrap } from "@/api/client";

export type PodBetLease = {
  acquired: boolean;
  leaseToken: string;
  state: string;
  venueOrderId: string;
};

export async function reservePodBetExecution(body: {
  alertId: string;
  venue: "OB" | "Polymarket" | "RAY";
  playerId: number;
}): Promise<PodBetLease> {
  return unwrap(await post<PodBetLease>("Client_ReservePodBet", body));
}

export async function finalizePodBetExecution(body: {
  leaseToken: string;
  state: "accepted" | "failed" | "unknown";
  venueOrderId?: string;
  message?: string;
}): Promise<void> {
  unwrap(await post("Client_FinalizePodBet", body));
}
