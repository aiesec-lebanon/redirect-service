import { Env } from "./types";

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
  return /^[A-Za-z0-9_-]{1,4}$/.test(group);
}

export function makeKey(group: string, slug: string) {
  return `${group}/${slug}`;
}

export async function getIndex(env: Env, key: string): Promise<string[]> {
  const raw = await env.INDEX.get(key);
  return raw ? JSON.parse(raw) : [];
}

export async function saveIndex(env: Env, key: string, values: string[]) {
  await env.INDEX.put(key, JSON.stringify(values));
}

export async function addToIndex(env: Env, key: string, value: string) {
  const list = await getIndex(env, key);
  if (!list.includes(value)) {
    list.push(value);
    await saveIndex(env, key, list);
  }
}

export async function removeFromIndex(env: Env, key: string, value: string) {
  const list = await getIndex(env, key);
  const updated = list.filter(v => v !== value);
  await saveIndex(env, key, updated);
}
