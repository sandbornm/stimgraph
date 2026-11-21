export function resolveRequestOrigin(request: Request, tailnet?: string, publicOrigin?: string) {
  if (tailnet === 'true' && publicOrigin) return new URL(publicOrigin).origin;
  return new URL(request.url).origin;
}
