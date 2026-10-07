export function isPmAmbiguousOrderError(message: unknown): boolean;
export function pmSubmitRejectionFromHttp(status: unknown, data: unknown): {
  success: false; errorMsg: string; pmSubmitRejected: true;
} | null;
