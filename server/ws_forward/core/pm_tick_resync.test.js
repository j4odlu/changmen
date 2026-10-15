import { expect, it, vi } from "vitest";
import { notifyPmTickResync } from "./pm_tick_resync.js";

it("notifies only connected subscribed clients, with backpressure protection and no quote coalescing", () => {
  const client = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() });
  const open = client(), blocked = client(), closed = client(), idle = client();
  closed.readyState = 3;
  const clients = new Map([open, blocked, closed, idle].map(socket => [socket, {
    assetIds: new Set(socket === idle ? [] : ["t"]), sentToClient: 0,
  }]));
  notifyPmTickResync(clients, { isSendAllowed: socket => socket !== blocked });
  expect(open.send).toHaveBeenCalledWith('{"event_type":"changmen_tick_resync"}');
  expect(clients.get(open).sentToClient).toBe(1);
  expect(blocked.send).not.toHaveBeenCalled();
  expect(blocked.close).toHaveBeenCalledWith(1013, "tick resync backpressure");
  expect(closed.send).not.toHaveBeenCalled(); expect(idle.send).not.toHaveBeenCalled();
});

it("one failed socket cannot prevent another client from resyncing", () => {
  const failed = { readyState: 1, send() { throw Error("closed"); } };
  const open = { readyState: 1, send: vi.fn() };
  notifyPmTickResync(new Map([failed, open].map(socket => [socket, { assetIds: new Set(["t"]), sentToClient: 0 }])), { isSendAllowed: () => true });
  expect(open.send).toHaveBeenCalledOnce();
});
