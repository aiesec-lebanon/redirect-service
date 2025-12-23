import { Env, RedirectEntry } from "./types";
import { jsonResponse, makeKey, validateGroup, validateSlug, addToIndex, removeFromIndex, getIndex } from "./utils";

const DEFAULT_PAGE_SIZE = "20";
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

  // ADD TO GLOBAL INDEX
  await addToIndex(env, "__ALL__", key);

  // ADD TO USER INDEX
  await addToIndex(env, `__USER__:${createdBy}`, key);

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
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") || DEFAULT_PAGE_SIZE, 10);

  const allKeys = await getIndex(env, "__ALL__");

  const totalItems = allKeys.length;
  const totalPages = Math.ceil(totalItems / pageSize);

  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  const pageKeys = allKeys.slice(start, end);

  const items = await Promise.all(
    pageKeys.map(async (k) => {
      const raw = await env.REDIRECTS.get(k);
      return { key: k, data: raw ? JSON.parse(raw) : null };
    })
  );

  return jsonResponse({
    page,
    pageSize,
    totalItems,
    totalPages,
    items
  });
}

export async function listRedirectsByUser(request: Request, env: Env) {
  const url = new URL(request.url);
  const user = url.searchParams.get("user")!;
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("pageSize") || "20");

  const userKeys = await getIndex(env, `__USER__:${user}`);

  const totalItems = userKeys.length;
  const totalPages = Math.ceil(totalItems / pageSize);

  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  const pageKeys = userKeys.slice(start, end);

  const items = await Promise.all(
    pageKeys.map(async (k) => {
      const raw = await env.REDIRECTS.get(k);
      return { key: k, data: raw ? JSON.parse(raw) : null };
    })
  );

  return jsonResponse({
    user,
    page,
    pageSize,
    totalItems,
    totalPages,
    items
  });
}

export async function editRedirect(
  request: Request,
  env: Env,
  group: string,
  slug: string
) {
  const oldKey = makeKey(group, slug);

  const existingStr = await env.REDIRECTS.get(oldKey);
  if (!existingStr) return jsonResponse({ error: "Not found" }, 404);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "Missing JSON body" }, 400);
  }

  const parsed = JSON.parse(existingStr) as RedirectEntry;

  // ✅ Allowed editable fields
  const allowed = ["target", "title", "notes", "group", "slug"];
  const updateFields: Partial<RedirectEntry> = {};

  for (const f of allowed) {
    if (f in body) (updateFields as any)[f] = (body as any)[f];
  }

  if (Object.keys(updateFields).length === 0) {
    return jsonResponse({ error: "Nothing to update" }, 400);
  }

  // ✅ Validate new target if provided
  if (updateFields.target) {
    try {
      new URL(updateFields.target);
    } catch {
      return jsonResponse({ error: "Invalid target URL" }, 400);
    }
  }

  // ✅ Validate new group/slug if provided
  if (updateFields.group && !validateGroup(updateFields.group)) {
    return jsonResponse({ error: "Invalid group" }, 400);
  }
  if (updateFields.slug && !validateSlug(updateFields.slug)) {
    return jsonResponse({ error: "Invalid slug" }, 400);
  }

  const newGroup = updateFields.group ?? parsed.group;
  const newSlug = updateFields.slug ?? parsed.slug;

  const newKey = makeKey(newGroup, newSlug);

  // ✅ Prevent key collision
  if (newKey !== oldKey) {
    const exists = await env.REDIRECTS.get(newKey);
    if (exists) {
      return jsonResponse({ error: "New slug already exists" }, 409);
    }
  }

  const updated: RedirectEntry = {
    ...parsed,
    ...updateFields,
    group: newGroup,
    slug: newSlug,
    updatedAt: new Date().toISOString(),
  };

  // ✅ If key DID NOT change → simple update
  if (newKey === oldKey) {
    await env.REDIRECTS.put(oldKey, JSON.stringify(updated));
    return jsonResponse({ message: "Updated" });
  }

  // ✅ If key CHANGED → move everything safely

  // 1️⃣ Move redirect record
  await env.REDIRECTS.put(newKey, JSON.stringify(updated));
  await env.REDIRECTS.delete(oldKey);

  // 2️⃣ Move click counter
  const clicks = await env.CLICKS.get(oldKey);
  if (clicks) {
    await env.CLICKS.put(newKey, clicks);
    await env.CLICKS.delete(oldKey);
  }

  // 3️⃣ Update INDEX.__ALL__
  await removeFromIndex(env, "__ALL__", oldKey);
  await addToIndex(env, "__ALL__", newKey);

  // 4️⃣ Update INDEX.__USER__:{createdBy}
  const userIndexKey = `__USER__:${parsed.createdBy}`;
  await removeFromIndex(env, userIndexKey, oldKey);
  await addToIndex(env, userIndexKey, newKey);

  return jsonResponse({
    message: "Updated and key moved",
    oldKey,
    newKey,
  });
}

export async function deleteRedirect(request: Request, env: Env, group: string, slug: string) {
  const key = makeKey(group, slug);
  const exists = await env.REDIRECTS.get(key);
  if (!exists) return jsonResponse({ error: "Not found" }, 404);
  else {
    const parsed = JSON.parse(exists) as RedirectEntry;
    
    // REMOVE FROM GLOBAL INDEX
    await removeFromIndex(env, "__ALL__", key);

    // REMOVE FROM USER INDEX
    await removeFromIndex(env, `__USER__:${parsed.createdBy}`, key);
  }
  await env.REDIRECTS.delete(key);
  await env.CLICKS.delete(key).catch((e) => console.error("Failed to delete clicks:", e));
  return jsonResponse({ message: "Deleted" });
}