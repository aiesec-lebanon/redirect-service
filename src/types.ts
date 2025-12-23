export interface Env {
  REDIRECTS: KVNamespace;
  CLICKS: KVNamespace;
  INDEX: KVNamespace;
  ADMIN_API_KEY?: string;
}

export interface RedirectEntry {
  target: string;
  group: string;
  slug: string;
  createdBy: string;
  createdAt: string; // ISO
  updatedAt?: string; // ISO
  title?: string;
  notes?: string;
  // add custom fields here if needed
}

export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
export interface JSONObject { [k: string]: JSONValue }
export interface JSONArray extends Array<JSONValue> {}