/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Env } from "./types";
import requireAuth from "./auth";
import { jsonResponse, textResponse, makeKey, validateGroup, validateSlug } from "./utils";
import handlePublicRedirect from "./redirect";
import { createRedirect, checkSlug, listRedirects, listRedirectsByUser, editRedirect, deleteRedirect } from "./admin";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // Admin API
      if (pathname.startsWith("/admin/redirects")) {
        // Authentication
        const auth = await requireAuth(request, env);
        if (!auth.ok) return auth.response;

        // route matching
        // e.g.
        // POST   /admin/redirects
        // GET    /admin/redirects/check?group=&slug=
        // GET    /admin/redirects?cursor=&pageSize=
        // GET    /admin/redirects/by-user?user=
        // PUT    /admin/redirects/{group}/{slug}
        // DELETE /admin/redirects/{group}/{slug}
        const parts = pathname.split("/").filter(Boolean); // ["admin","redirects", ...]
        const method = request.method.toUpperCase();

        // /admin/redirects (collection)
        if (parts.length === 2) {
          if (method === "POST") return await createRedirect(request, env);
          if (method === "GET") {
            // check if caller asked for check
            if (url.searchParams.has("group") && url.searchParams.has("slug") && url.pathname.endsWith("/check")) {
              // unreachable since check is at /admin/redirects/check. handle below.
            }
            // general list
            return await listRedirects(request, env);
          }
          return jsonResponse({ error: "Method not allowed" }, 405);
        }

        // /admin/redirects/check
        if (parts.length === 3 && parts[2] === "check" && method === "GET") {
          return await checkSlug(request, env);
        }

        // /admin/redirects/by-user
        if (parts.length === 3 && parts[2] === "by-user" && method === "GET") {
          return await listRedirectsByUser(request, env);
        }

        // /admin/redirects/{group}/{slug}
        if (parts.length === 4) {
          const group = parts[2];
          const slug = parts[3];
          if (!validateGroup(group) || !validateSlug(slug)) return jsonResponse({ error: "Invalid path" }, 400);

          if (method === "PUT") return await editRedirect(request, env, group, slug);
          if (method === "DELETE") return await deleteRedirect(request, env, group, slug);
          if (method === "GET") {
            // get single redirect
            const key = makeKey(group, slug);
            const entryStr = await env.REDIRECTS.get(key);
            if (!entryStr) return jsonResponse({ error: "Not found" }, 404);
            const entry = JSON.parse(entryStr);
            const clicks = parseInt((await env.CLICKS.get(key)) || "0", 10);
            return jsonResponse({ key, data: entry, clicks });
          }
        }

        return jsonResponse({ error: "Not found" }, 404);
      }

      // Public redirect paths: /{group}/{slug}
      const publicParts = pathname.split("/").filter(Boolean);

      // If request is root or admin UI path etc. Check for admin UI fallback (optional)
      if (publicParts.length >= 2 && publicParts[0] !== "admin") {
        return await handlePublicRedirect(request, env);
      }

      // default fallback
      return textResponse("OK", 200);
    } catch (err: any) {
      console.error("Unhandled error:", err);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  },
};