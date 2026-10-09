import { describe, expect, it } from "vitest";
import {
  buildOnyxQuery,
  formatOnyxSection,
  normalizeOnyxHits,
  queryOnyxContext,
  resolveOnyxConfig,
  shaOnyxReference,
} from "./onyxContext";

const task = { title: "Fix navigation", spec: "Restore selection on refresh" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const liveShape = {
  tenantId: "default",
  query: "Fix navigation",
  hits: [
    { sourcePath: "C:/corpus/Mstudio-ade.md", note: "Mstudio-ade.md", heading: "Saber", excerpt: "A terminal-first workspace.", mtime: "2026-09-18T11:12:56.943Z", score: 3 },
    { sourcePath: "C:/corpus/Mstudio-ade.md", note: "Mstudio-ade.md", heading: "What it is", excerpt: "An agentic forge.", mtime: "2026-09-18T11:12:56.943Z", score: 2 },
  ],
};

describe("onyx context client", () => {
  it("resolves defaults, trims the base URL, and honors the disabled flag", () => {
    expect(resolveOnyxConfig({})).toMatchObject({ baseUrl: "http://127.0.0.1:8083", tenantId: "default", disabled: false });
    expect(resolveOnyxConfig({ ONYX_BASE_URL: "http://onyx:8083///", ONYX_TENANT_ID: "acme" })).toMatchObject({ baseUrl: "http://onyx:8083", tenantId: "acme", disabled: false });
    expect(resolveOnyxConfig({ ONYX_DISABLED: "1" }).disabled).toBe(true);
    expect(resolveOnyxConfig({ ONYX_BASE_URL: "" }).disabled).toBe(true);
  });

  it("bounds the query text deterministically", () => {
    expect(buildOnyxQuery(task)).toBe("Fix navigation\nRestore selection on refresh");
    const long = buildOnyxQuery({ title: "T", spec: "x".repeat(5000) });
    expect(long).toBe(`T\n${"x".repeat(500)}`);
  });

  it("captures a sha over the normalized live shape", async () => {
    const result = await queryOnyxContext(task, {}, async () => jsonResponse(liveShape));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sha).toBe(shaOnyxReference("default", result.query, result.hits));
    expect(result.hits).toHaveLength(2);
  });

  it("accepts the snake_case contract variant with an identical sha", async () => {
    const snake = {
      hits: liveShape.hits.map((hit) => ({ source_path: hit.sourcePath, note: hit.note, heading: hit.heading, excerpt: hit.excerpt, mtime: hit.mtime, score: hit.score })),
    };
    const fromLive = await queryOnyxContext(task, {}, async () => jsonResponse(liveShape));
    const fromSnake = await queryOnyxContext(task, {}, async () => jsonResponse(snake));
    expect(fromSnake.ok).toBe(true);
    if (!fromLive.ok || !fromSnake.ok) return;
    expect(fromSnake.sha).toBe(fromLive.sha);
  });

  it("drops malformed entries and rejects a missing hits array", async () => {
    const mixed = await queryOnyxContext(task, {}, async () => jsonResponse({ hits: [...liveShape.hits, { nope: true }, "x", { sourcePath: "C:/a", heading: "H" }] }));
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.hits).toHaveLength(2);
    const missing = await queryOnyxContext(task, {}, async () => jsonResponse({ answer: "hi" }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.notice).toContain("invalid");
  });

  it("records an ok sha with no prompt section for empty hits", async () => {
    const result = await queryOnyxContext(task, {}, async () => jsonResponse({ hits: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits).toEqual([]);
    expect(formatOnyxSection(result.sha, [])).toBe(`Project context from Onyx (cited, ${result.sha.slice(0, 8)}):`);
  });

  it("reports non-200, unreachable, timed-out, and invalid JSON distinctly", async () => {
    const refused = await queryOnyxContext(task, {}, async () => jsonResponse({}, 503));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.notice).toContain("503");
    const down = await queryOnyxContext(task, {}, async () => { throw new Error("connect"); });
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.notice).toContain("unreachable");
    const slow = await queryOnyxContext(task, {}, async () => { throw Object.assign(new Error("abort"), { name: "TimeoutError" }); });
    expect(slow.ok).toBe(false);
    if (!slow.ok) expect(slow.notice).toContain("timed out");
    const broken = await queryOnyxContext(task, {}, async () => new Response("not json", { status: 200 }));
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.notice).toContain("invalid");
  });

  it("sends the tenant header with an abort signal and caps excerpts", async () => {
    let seen: RequestInit | undefined;
    const big = "y".repeat(5000);
    await queryOnyxContext(task, { baseUrl: "http://onyx:8083", tenantId: "acme" }, async (url, init) => {
      seen = init;
      expect(url).toContain("http://onyx:8083/context/query?q=");
      return jsonResponse({ hits: [{ ...liveShape.hits[0], excerpt: big }] });
    });
    expect(seen?.headers).toMatchObject({ "x-tenant-id": "acme" });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(normalizeOnyxHits({ hits: [{ ...liveShape.hits[0], excerpt: big }] })[0]?.excerpt).toHaveLength(2000);
  });

  it("skips the fetch entirely when disabled", async () => {
    let called = false;
    const result = await queryOnyxContext(task, { disabled: true }, async () => { called = true; return jsonResponse({}); });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.notice).toContain("disabled");
  });

  it("formats cited hits with the short sha", () => {
    const text = formatOnyxSection("abcdef123456", normalizeOnyxHits(liveShape));
    expect(text).toContain("Project context from Onyx (cited, abcdef12):");
    expect(text).toContain("[1] A terminal-first workspace. (Mstudio-ade.md — Saber)");
  });
});
