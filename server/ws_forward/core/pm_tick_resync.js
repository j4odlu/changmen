/** [changmen 扩展] 上游重连不能仅靠浏览器重连感知；控制帧不进入报价合并队列。 */
export function notifyPmTickResync(clients, guard) {
  const raw = JSON.stringify({ event_type: "changmen_tick_resync" });
  for (const [socket, row] of clients) {
    if (socket.readyState !== 1 || !row.assetIds.size) continue;
    try {
      if (!guard.isSendAllowed(socket)) { socket.close(1013, "tick resync backpressure"); continue; }
      socket.send(raw);
      row.sentToClient++;
    } catch { /* 一个断开的客户端不影响其它客户端 */ }
  }
}
