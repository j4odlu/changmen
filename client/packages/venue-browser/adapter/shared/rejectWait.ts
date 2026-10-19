/** 场馆拒单检测：拉单前的固定等待（秒） */
export async function venueRejectWaitBeforePoll(rejectWaitSec?: number): Promise<void> {
  if (rejectWaitSec == null || rejectWaitSec <= 0)
    return;
  await new Promise<void>(resolve => {
    setTimeout(resolve, rejectWaitSec * 1000);
  });
}
