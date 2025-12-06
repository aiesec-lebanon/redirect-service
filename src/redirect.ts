import { Env, RedirectEntry } from "./types";
import { textResponse, makeKey } from "./utils";

export default async function handlePublicRedirect(request: Request, env: Env) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);

  // if someone hits root or admin path, return 400 or let admin handler handle
  if (parts.length < 2) return textResponse("Invalid redirect path", 400);

  // first two path parts are group and slug
  const group = parts[0];
  const slug = parts[1];
  const key = makeKey(group, slug);

  // get entry (stored as JSON string)
  const entryStr = await env.REDIRECTS.get(key);
  if (!entryStr) return textResponse("Redirect not found", 404);

  let entry: RedirectEntry;
  try {
    entry = JSON.parse(entryStr) as RedirectEntry;
  } catch (e) {
    // corrupted entry
    return textResponse("Redirect data corrupted", 500);
  }

  // increment clicks asynchronously (fire-and-forget)
  env.CLICKS.put(key, (parseInt((await env.CLICKS.get(key)) || "0", 10) + 1).toString()).catch((e) =>
    console.error("Failed to increment clicks:", e)
  );

  // redirect
  return Response.redirect(entry.target, 302);
}