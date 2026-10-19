// Explicit owners for historical single-consumer regressions; not production entry points.
import { BookStore } from "../../realtime/orderBook/bookStore";
import type { BookFeedOptions, BookFeed } from "../../realtime/orderBook/feedTypes";
import { PmOrderBookService } from "../../realtime/orderBook/service";
import type { WorkerPort } from "../../realtime/orderBook/serviceProtocol";
import { WsBookShadowRuntime } from "../../submission/preflight/optimized/wsBook/bookRuntime";
import { WsBookShadowWorkerClient } from "../../submission/preflight/optimized/wsBook/shadowWorkerClient";
import type { fetchShadowHttpBook } from "../../submission/preflight/optimized/wsBook/bookMetadata";
export class OwnedRuntimeFixture extends WsBookShadowRuntime {
  readonly store: BookStore;
  readonly feed: BookFeed;
  constructor(allowed: () => boolean, options: { feedFactory?: (options: BookFeedOptions) => BookFeed; fetchBook?: typeof fetchShadowHttpBook } = {}) {
    const store = new BookStore(allowed, options.feedFactory);
    super(allowed, store.reader, options); this.store = store; this.feed = store.feed;
  }
  override setAssets(ids: readonly string[]) { this.feed.setAssets(ids); super.setAssets(ids); }
  override stop() { super.stop(); this.store.stop(); }
}
export class OwnedWorkerFixture extends WsBookShadowWorkerClient {
  readonly owner: PmOrderBookService;
  constructor(allowed: () => boolean, factory: () => WorkerPort) {
    const owner = new PmOrderBookService(allowed, factory);
    super(allowed, owner); this.owner = owner;
  }
  override stop() { super.stop(); this.owner.stop(); }
}
