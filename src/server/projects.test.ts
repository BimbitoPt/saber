import { describe, it, expect } from "vitest";
import { tokenPath } from "./projects";

describe("tokenPath", () => {
  it("expands %USERPROFILE%", () => {
    expect(tokenPath("%USERPROFILE%\\Desktop\\Automaçao")).toBe(
      `${process.env["USERPROFILE"]}\\Desktop\\Automaçao`,
    );
  });
});
