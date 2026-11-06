import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, jsonResponse, routeError } from "./http";

afterEach(() => vi.restoreAllMocks());

describe("HTTP error response safety", () => {
  it("removes stack fields from nested response data", async () => {
    const response = jsonResponse({
      ok: false,
      diagnostic: { message: "safe detail", stack: "Error: secret\\n at /srv/private/server.ts:10" },
    });

    expect(await response.json()).toEqual({
      ok: false,
      diagnostic: { message: "safe detail" },
    });
  });

  it("does not serialize Error objects into client responses", async () => {
    const error = new Error("database password path /srv/private/db.sqlite");
    const response = jsonResponse({ cause: error });

    expect(await response.json()).toEqual({
      cause: { error: "The request could not be completed." },
    });
  });

  it("returns a generic client message while logging the original error", async () => {
    const error = new Error("SQL query failed at /srv/private/server.ts:10");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = errorResponse(error, 500);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "The request could not be completed." });
    expect(log).toHaveBeenCalledWith(error);
  });

  it("keeps route status classification without exposing exception details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = routeError(new Error("Task not found at /srv/private/taskStore.ts"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Resource not found." });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("allows an explicitly supplied client-safe message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = errorResponse(new Error("internal details"), 400, "Project path is invalid.");

    expect(await response.json()).toEqual({ error: "Project path is invalid." });
  });

  it("passes clean validation messages through to the client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = routeError(new Error("Choose an absolute project directory"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Choose an absolute project directory" });
  });

  it("masks oversized or non-Error rejection values", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const oversized = routeError(new Error("x".repeat(301)));
    const nonError = routeError("Select a project before saving");

    expect(await oversized.json()).toEqual({ error: "The request could not be completed." });
    expect(await nonError.json()).toEqual({ error: "The request could not be completed." });
  });
});
