import { Env, RedirectEntry } from "./types";
import { jsonResponse, makeKey, validateGroup, validateSlug } from "./utils";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export async function createRedirect(request: Request, env: Env) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonResponse({ error: "Missing JSON body" }, 400);

  const { group, slug, target, createdBy, title, notes } = body as Partial<RedirectEntry>;

  if (!group || !slug || !target || !createdBy) {
    return jsonResponse({ error: "group, slug, target, createdBy are required" }, 400);
  }
  if (!validateGroup(group)) return jsonResponse({ error: "Invalid group" }, 400);
  if (!validateSlug(slug)) return jsonResponse({ error: "Invalid slug (allowed: A-Z a-z 0-9 _ -)" }, 400);

  // validate URL
  try {
    // allow relative? No. Must be absolute URL
    new URL(target);
  } catch (e) {
    return jsonResponse({ error: "Invalid target URL" }, 400);
  }

  const key = makeKey(group, slug);
  const exists = await env.REDIRECTS.get(key);
  if (exists) return jsonResponse({ error: "Slug already taken" }, 409);

  const now = new Date().toISOString();
  const entry: RedirectEntry = {
    target,
    group,
    slug,
    createdBy,
    createdAt: now,
    updatedAt: now,
    title,
    notes,
  };

  await env.REDIRECTS.put(key, JSON.stringify(entry));
  // init clicks to 0
  await env.CLICKS.put(key, "0").catch((e) => console.error("Failed to init clicks:", e));

  return jsonResponse({ message: "Redirect created", key }, 201);
}

export async function checkSlug(request: Request, env: Env) {
  const url = new URL(request.url);
  const group = url.searchParams.get("group") || "";
  const slug = url.searchParams.get("slug") || "";
  if (!group || !slug) return jsonResponse({ error: "group and slug required" }, 400);
  if (!validateGroup(group) || !validateSlug(slug)) return jsonResponse({ error: "invalid group or slug" }, 400);

  const exists = Boolean(await env.REDIRECTS.get(makeKey(group, slug)));
  return jsonResponse({ exists });
}

export async function listRedirects(request: Request, env: Env) {
  const url = new URL(request.url);
  const rawCursor = url.searchParams.get("cursor") || undefined;
  let pageSize = parseInt(url.searchParams.get("pageSize") || "", 10);
  if (Number.isNaN(pageSize) || pageSize <= 0) pageSize = DEFAULT_PAGE_SIZE;
  pageSize = Math.min(pageSize, MAX_PAGE_SIZE);

  // KV list supports a limit up to 1000; we'll request pageSize keys and return values
  const listResult: KVNamespaceListResult<RedirectEntry, string> = await env.REDIRECTS.list({ cursor: rawCursor, limit: pageSize });
  const keys = listResult.keys || [];

  // Fetch values in parallel
  const items = await Promise.all(
    keys.map(async (k) => {
      const name = k.name;
      const valueStr = await env.REDIRECTS.get(name);
      let data: RedirectEntry | null = null;
      try {
        if (valueStr) data = JSON.parse(valueStr);
      } catch (e) {
        data = null;
      }
      return { key: name, data };
    })
  );

  return jsonResponse({
    items,
    cursor: listResult.cursor ?? null,
    listComplete: listResult.list_complete,
  });
}

export async function listRedirectsByUser(request: Request, env: Env) {
  const url = new URL(request.url);
  const user = url.searchParams.get("user") || "";
  if (!user) return jsonResponse({ error: "user is required" }, 400);

  let pageSize = parseInt(url.searchParams.get("pageSize") || "", 10);
  if (Number.isNaN(pageSize) || pageSize <= 0) pageSize = DEFAULT_PAGE_SIZE;
  pageSize = Math.min(pageSize, MAX_PAGE_SIZE);
  let cursor = url.searchParams.get("cursor") || undefined;

  // We'll iterate through pages of KV keys and filter by createdBy until we gather pageSize items or list is complete.
  const collected: Array<{ key: string; data: RedirectEntry | null }> = [];
  let listComplete = false;

  while (collected.length < pageSize && !listComplete) {
    const res = await env.REDIRECTS.list({ cursor, limit: 100 });
    const keys = res.keys || [];
    for (const k of keys) {
      const name = k.name;
      const valueStr = await env.REDIRECTS.get(name);
      if (!valueStr) continue;
      try {
        const parsed = JSON.parse(valueStr) as RedirectEntry;
        if (parsed.createdBy === user) {
          collected.push({ key: name, data: parsed });
          if (collected.length >= pageSize) break;
        }
      } catch (e) {
        // skip corrupted
      }
    }
    cursor = res.cursor ?? null;
    listComplete = !!res.list_complete;
    if (!cursor && listComplete) break;
  }

  return jsonResponse({
    items: collected,
    cursor,
    listComplete,
  });
}

export async function editRedirect(request: Request, env: Env, group: string, slug: string) {
  const key = makeKey(group, slug);
  const existingStr = await env.REDIRECTS.get(key);
  if (!existingStr) return jsonResponse({ error: "Not found" }, 404);

  const body = await request.json().catch(() => null);
  if (!body) return jsonResponse({ error: "Missing JSON body" }, 400);

  // Only allowing update of `target`, `title`, `notes`. Changing slug/group requires delete+create.
  const allowed = ["target", "title", "notes"];
  const updateFields: Partial<RedirectEntry> = {};
  if (body && typeof body === "object") {
    for (const f of allowed) {
      if (f in body) (updateFields as any)[f] = (body as any)[f];
    }
  }

  if (Object.keys(updateFields).length === 0) return jsonResponse({ error: "Nothing to update" }, 400);

  // validate updated target if present
  if (updateFields.target) {
    try {
      new URL(updateFields.target as string);
    } catch (e) {
      return jsonResponse({ error: "Invalid target URL" }, 400);
    }
  }

  const parsed = JSON.parse(existingStr) as RedirectEntry;
  const updated: RedirectEntry = {
    ...parsed,
    ...updateFields,
    updatedAt: new Date().toISOString(),
  };

  await env.REDIRECTS.put(key, JSON.stringify(updated));
  return jsonResponse({ message: "Updated" });
}

export async function deleteRedirect(request: Request, env: Env, group: string, slug: string) {
  const key = makeKey(group, slug);
  const exists = await env.REDIRECTS.get(key);
  if (!exists) return jsonResponse({ error: "Not found" }, 404);
  await env.REDIRECTS.delete(key);
  await env.CLICKS.delete(key).catch((e) => console.error("Failed to delete clicks:", e));
  return jsonResponse({ message: "Deleted" });
}