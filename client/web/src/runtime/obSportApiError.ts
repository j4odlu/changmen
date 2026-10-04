/** [changmen 扩展] 区分已收到的场馆业务拒绝与提交后传输异常。 */
export class ObSportApiError extends Error {
  constructor(readonly apiPath: string, readonly code: string, message: string) {
    super(`OB sport ${apiPath} code=${code} ${message}`);
    this.name = "ObSportApiError";
  }
}
