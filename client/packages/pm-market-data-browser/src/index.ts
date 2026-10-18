/** [changmen 扩展] 无全局单例、无预检/签名/提交依赖。服务管理簿生命周期；消费者仅管理读取租约，不管理 PM-M 订阅。 */
export { BOOK_LIMITS, decimal, numericAsks, reduceBookFrame } from "./bookReducer";
export type { LocalOrderBook, ReducedFrame } from "./bookReducer";
export { PassiveBookFeed } from "./passiveBookFeed";
export type { BookFeed, BookFeedOptions } from "./feedTypes";
export { BookStore } from "./bookStore";
export type { BookReader, DepthView, FullBookView } from "./bookStore";
export { PmOrderBookService, FULL_BOOK_READ_MS, FULL_BOOK_CATCHUPS } from "./service";
export type { BookHostPorts, ReadonlyMarketSourcePort, BookConsumerPort, BookLease, Admission, DiagnosticChannel } from "./service";
export type { WorkerPort } from "./serviceProtocol";
