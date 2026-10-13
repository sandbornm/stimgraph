declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS?: { fetch(request: Request): Promise<Response> };
  }
}
