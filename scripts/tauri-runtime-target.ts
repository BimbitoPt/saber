export type RuntimePlatform = "linux" | "win32";

export type NodeRuntimeTarget = {
  archiveName: string;
  platformDirectory: string;
  binaryRelativePath: string;
  sidecarFileName: string;
  extraction: "tar-xz" | "powershell-zip";
};

export function verifyArchiveChecksum(actual: string, expected: string | undefined): void {
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) {
    throw new Error("Official checksum manifest has no valid archive SHA-256 entry");
  }
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Archive SHA-256 mismatch: expected ${expected}, received ${actual}`);
  }
}

export function selectNodeRuntimeTarget(
  platform: string,
  architecture: string,
  version: string,
): NodeRuntimeTarget {
  if (architecture !== "x64") {
    throw new Error(`Node runtime preparation does not support ${architecture}`);
  }

  if (platform === "win32") {
    return {
      archiveName: `node-${version}-win-x64.zip`,
      platformDirectory: `node-${version}-win-x64`,
      binaryRelativePath: `node-${version}-win-x64/node.exe`,
      sidecarFileName: "node-x86_64-pc-windows-msvc.exe",
      extraction: "powershell-zip",
    };
  }

  if (platform === "linux") {
    return {
      archiveName: `node-${version}-linux-x64.tar.xz`,
      platformDirectory: `node-${version}-linux-x64`,
      binaryRelativePath: `node-${version}-linux-x64/bin/node`,
      sidecarFileName: "node-x86_64-unknown-linux-gnu",
      extraction: "tar-xz",
    };
  }

  throw new Error(`Node runtime preparation does not support ${platform}`);
}
