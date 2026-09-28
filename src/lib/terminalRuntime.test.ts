import { describe, expect, it } from "vitest";
import { isTerminalRuntimeAvailable } from "./terminalRuntime";

describe("terminal runtime detection", () => {
  it("does not treat browser preview as a native terminal runtime", () => {
    expect(isTerminalRuntimeAvailable(undefined)).toBe(false);
    expect(isTerminalRuntimeAvailable({})).toBe(false);
  });

  it("requires the Tauri internal bridge", () => {
    expect(isTerminalRuntimeAvailable({ __TAURI_INTERNALS__: {} })).toBe(true);
  });
});
