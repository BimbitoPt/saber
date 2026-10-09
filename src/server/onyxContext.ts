import { createHash } from "node:crypto";
import type { TaskRecord } from "../lib/tasks";

export const ONYX_DEFAULT_BASE_URL = "http://127.0.0.1:8083";
export const ONYX_DEFAULT_TENANT_ID = "default";
export const ONYX_TIMEOUT_MS = 8000;
export const ONYX_HIT_LIMIT = 3;
export const ONYX_QUERY_SPEC_CHARS = 500;
export const ONYX_EXCERPT_CHARS = 2000;

export interface OnyxConfig {
  baseUrl: string;
  tenantId: string;
  disabled: boolean;
}

export interface OnyxHit {
  sourcePath: string;
  note?: string;
  heading: string;
  excerpt: string;
  mtime: string;
  score: number;
}

export type OnyxResolution =
  | { ok: true; sha: string; hits: OnyxHit[]; query: string }
  | { ok: false; notice: string };

export function resolveOnyxConfig(env: NodeJS.ProcessEnv = process.env): OnyxConfig {
  const baseUrl = (env.ONYX_BASE_URL ?? ONYX_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const tenantId = (env.ONYX_TENANT_ID ?? ONYX_DEFAULT_TENANT_ID).trim() || ONYX_DEFAULT_TENANT_ID;
  return { baseUrl, tenantId, disabled: env.ONYX_DISABLED === "1" || baseUrl === "" };
}

export function buildOnyxQuery(task: Pick<TaskRecord, "title" | "spec">): string {
  return `${task.title}\n${task.spec.slice(0, ONYX_QUERY_SPEC_CHARS)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function normalizeOnyxHits(json: unknown): OnyxHit[] {
  const root = asRecord(json);
  const raw = root && Array.isArray(root.hits) ? root.hits : undefined;
  if (!raw) return [];
  const hits: OnyxHit[] = [];
  for (const entry of raw) {
    const hit = asRecord(entry);
    if (!hit) continue;
    const sourcePath = hit.sourcePath ?? hit.source_path;
    const heading = hit.heading;
    const excerpt = hit.excerpt;
    const mtime = hit.mtime;
    const score = hit.score;
    const note = hit.note;
    if (typeof sourcePath !== "string" || !sourcePath
      || typeof heading !== "string" || !heading
      || typeof excerpt !== "string" || !excerpt
      || typeof mtime !== "string" || !mtime
      || typeof score !== "number" || !Number.isFinite(score)) continue;
    hits.push({
      sourcePath,
      ...(typeof note === "string" && note ? { note } : {}),
      heading,
      excerpt: excerpt.slice(0, ONYX_EXCERPT_CHARS),
      mtime,
      score,
    });
  }
  return hits;
}

export function shaOnyxReference(tenantId: string, query: string, hits: OnyxHit[]): string {
  const canonical = JSON.stringify({
    tenantId,
    query,
    hits: hits.map((hit) => ({
      sourcePath: hit.sourcePath,
      note: hit.note ?? "",
      heading: hit.heading,
      excerpt: hit.excerpt,
      mtime: hit.mtime,
      score: hit.score,
    })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function formatOnyxSection(sha: string, hits: OnyxHit[]): string {
  const lines = hits.map((hit, index) => `[${index + 1}] ${hit.excerpt} (${hit.note ? `${hit.note} — ` : ""}${hit.heading})`);
  return [`Project context from Onyx (cited, ${sha.slice(0, 8)}):`, ...lines].join("\n");
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function queryOnyxContext(
  task: Pick<TaskRecord, "title" | "spec">,
  overrides: Partial<OnyxConfig> = {},
  fetchFn: FetchFn = fetch,
): Promise<OnyxResolution> {
  const config = { ...resolveOnyxConfig(), ...overrides };
  if (config.disabled) return { ok: false, notice: "Onyx context unavailable: disabled by configuration. The run launches with the local profile snapshot." };
  const query = buildOnyxQuery(task);
  let response: Response;
  try {
    response = await fetchFn(
      `${config.baseUrl}/context/query?q=${encodeURIComponent(query)}&limit=${ONYX_HIT_LIMIT}`,
      { headers: { "x-tenant-id": config.tenantId }, signal: AbortSignal.timeout(ONYX_TIMEOUT_MS) },
    );
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "unreachable";
    return { ok: false, notice: `Onyx context unavailable: the context service is ${reason}. The run launches with the local profile snapshot.` };
  }
  if (!response.ok) {
    return { ok: false, notice: `Onyx context unavailable: the context service returned status ${response.status}. The run launches with the local profile snapshot.` };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, notice: "Onyx context unavailable: the context response was invalid. The run launches with the local profile snapshot." };
  }
  const hits = normalizeOnyxHits(json);
  if (!Array.isArray((json as { hits?: unknown }).hits)) {
    return { ok: false, notice: "Onyx context unavailable: the context response was invalid. The run launches with the local profile snapshot." };
  }
  return { ok: true, sha: shaOnyxReference(config.tenantId, query, hits), hits, query };
}
