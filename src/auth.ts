import { Env } from "./types";
import { jsonResponse } from "./utils";

const ADMIN_HEADER = "X-Admin-Api-Key";

export default async function requireAuth(request: Request, env: Env) {
  const provided = request.headers.get(ADMIN_HEADER) || "";
  const expected = env.ADMIN_API_KEY || "";
  if (!expected) {
    // If no admin key configured, reject for safety. You can change this behavior.
    return { ok: false, response: jsonResponse({ error: "Admin API key not configured" }, 500) };
  }
  if (provided !== expected) {
    return { ok: false, response: jsonResponse({ error: "Unauthorized" }, 401) };
  }
  return { ok: true };
}