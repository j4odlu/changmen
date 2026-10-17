/** [changmen 扩展] 无全局单例、无预检/签名/提交依赖。服务管理簿生命周期；消费者仅管理读取租约，不管理 PM-M 订阅。 */
export { BOOK_LIMITS, decimal, numericAsks, reduceBookFrame } from "./bookReducer";
export type { LocalOrderBook, ReducedFrame } from "./bookReducer";
export { PassiveBookFeed } from "./passiveBookFeed";
export type { BookFeed, BookFeedOptions } from "./feedTypes";
