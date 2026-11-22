import { getRuntimeValue } from './runtime-env';
import { resolveRequestOrigin } from './request-origin-core';

export function requestOrigin(request: Request) {
  return resolveRequestOrigin(
    request,
    getRuntimeValue('STIMGRAPH_TAILNET'),
    getRuntimeValue('STIMGRAPH_PUBLIC_ORIGIN'),
  );
}
