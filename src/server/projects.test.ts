import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { tokenPath } from "./projects";

describe("tokenPath", () => {
  it("expands %USERPROFILE%", () => {
    expect(tokenPath("%USERPROFILE%\\Desktop\\Automaçao")).toBe(
      `${homedir()}\\Desktop\\Automaçao`,
    );
  });
});
