export class XRequestError extends Error {
  status: number;
  retryAt: number;
  revoked: boolean;
  constructor(status: number, retryAt: number = 0, revoked = false) {
    super(`X request failed with status ${status}`);
    this.status = status;
    this.retryAt = retryAt;
    this.revoked = revoked;
  }
}

export function retryTime(response: Response, now = Date.now()) {
  const retry = response.headers.get('retry-after');
  const reset = Number(response.headers.get('x-rate-limit-reset')) * 1000;
  const seconds = Number(retry);
  const after = retry ? (Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retry)) : 0;
  return Math.max(now, Number.isFinite(after) ? after : 0, Number.isFinite(reset) ? reset : 0);
}
