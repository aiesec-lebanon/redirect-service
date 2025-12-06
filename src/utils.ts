export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function textResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

export function validateSlug(slug: string) {
  // allow letters, numbers, -, _
  return /^[A-Za-z0-9_-]{1,128}$/.test(slug);
}

export function validateGroup(group: string) {
  return /^[A-Za-z0-9_-]{1,32}$/.test(group);
}

export function makeKey(group: string, slug: string) {
  return `${group}/${slug}`;
}