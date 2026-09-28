import { describe, expect, it } from "vitest";
import { selectNodeRuntimeTarget, verifyArchiveChecksum } from "./tauri-runtime-target";

describe("selectNodeRuntimeTarget", () => {
  it("keeps the Windows x64 archive and external-binary target", () => {
    expect(selectNodeRuntimeTarget("win32", "x64", "v24.21.0")).toEqual({
      archiveName: "node-v24.21.0-win-x64.zip",
      platformDirectory: "node-v24.21.0-win-x64",
      binaryRelativePath: "node-v24.21.0-win-x64/node.exe",
      sidecarFileName: "node-x86_64-pc-windows-msvc.exe",
      extraction: "powershell-zip",
    });
  });

  it("selects the Linux x64 archive and Tauri target triple", () => {
    expect(selectNodeRuntimeTarget("linux", "x64", "v24.21.0")).toEqual({
      archiveName: "node-v24.21.0-linux-x64.tar.xz",
      platformDirectory: "node-v24.21.0-linux-x64",
      binaryRelativePath: "node-v24.21.0-linux-x64/bin/node",
      sidecarFileName: "node-x86_64-unknown-linux-gnu",
      extraction: "tar-xz",
    });
  });

  it.each([
    ["linux", "arm64"],
    ["darwin", "x64"],
    ["win32", "arm64"],
  ])("rejects unsupported platform/architecture %s/%s", (platform, architecture) => {
    expect(() => selectNodeRuntimeTarget(platform, architecture, "v24.21.0")).toThrow(
      /does not support/,
    );
  });
});

describe("verifyArchiveChecksum", () => {
  const validHash = "fd8e59d5a5110000000000000000000000000000000000000000000000000000";

  it("accepts a matching official archive checksum", () => {
    expect(() => verifyArchiveChecksum(validHash, validHash)).not.toThrow();
  });

  it("rejects a mismatched or missing manifest checksum", () => {
    expect(() => verifyArchiveChecksum(validHash, "0".repeat(64))).toThrow(/SHA-256 mismatch/);
    expect(() => verifyArchiveChecksum(validHash, undefined)).toThrow(/manifest/);
  });
});
