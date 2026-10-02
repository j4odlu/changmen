import { post, unwrap } from "@/api/client";

export interface LeaderboardUser {
  userId: string;
  userName: string;
  isAdmin: boolean;
  excluded: boolean;
}

export async function getLeaderboardUsers() {
  return unwrap(await post<LeaderboardUser[]>("Client_AdminLeaderboardUsers", {}));
}

export async function setLeaderboardExcluded(userId: string, excluded: boolean) {
  return unwrap(await post<LeaderboardUser>("Client_AdminSetLeaderboardExcluded", { userId, excluded }));
}
