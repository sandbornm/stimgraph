// Default deployment uses Cloudflare. The local production build aliases this
// module to local-platform.ts; the application storage API stays the same.
export { env } from 'cloudflare:workers';
