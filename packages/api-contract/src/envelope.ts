/** 对齐 server/backend/core/esport-api/router 与 client/web api/client 通用响应 */
export interface ApiSuccess<T = unknown> {
  success: 1;
  msg?: string;
  info?: T | null;
}

export interface ApiFailure {
  success: 0;
  /** 稳定的机器错误码；msg 仅供展示，旧客户端可继续只读 msg。 */
  code?: string;
  msg?: string;
  info?: null;
}

export type ApiEnvelope<T = unknown> = ApiSuccess<T> | ApiFailure;
