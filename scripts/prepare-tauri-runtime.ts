import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { selectNodeRuntimeTarget, verifyArchiveChecksum } from "./tauri-runtime-target";

const version = "v24.21.0";
const target = selectNodeRuntimeTarget(process.platform, process.arch, version);
const root = resolve(import.meta.dir, "..");
const archiveUrl = `https://nodejs.org/dist/${version}/${target.archiveName}`;
const checksumsUrl = `https://nodejs.org/dist/${version}/SHASUMS256.txt`;
const binaryOutput = join(root, "src-tauri", "binaries", target.sidecarFileName);
const outputTree = join(root, ".output");
const resourceOutput = join(root, "src-tauri", "resources", "saber-server", ".output");

async function requireOk(response: Response, name: string): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`Could not download ${name}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

function requireCommand(program: string, args: string[], label: string): void {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    windowsHide: process.platform === "win32",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
}

const temp = await mkdtemp(join(tmpdir(), "saber-node-runtime-"));
try {
  const [archiveBytes, checksumBytes] = await Promise.all([
    fetch(archiveUrl).then((response) => requireOk(response, target.archiveName)),
    fetch(checksumsUrl).then((response) => requireOk(response, "Node checksum manifest")),
  ]);
  const manifest = new TextDecoder().decode(checksumBytes);
  const entry = manifest
    .split(/\r?\n/)
    .find((line) => line.trimEnd().endsWith(`  ${target.archiveName}`));
  const expected = entry?.trim().split(/\s+/)[0]?.toLowerCase();
  const actual = createHash("sha256").update(archiveBytes).digest("hex");
  verifyArchiveChecksum(actual, expected);

  const archivePath = join(temp, target.archiveName);
  await Bun.write(archivePath, archiveBytes);
  const extractPath = join(temp, "extracted");
  await mkdir(extractPath, { recursive: true });
  if (target.extraction === "powershell-zip") {
    requireCommand(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${extractPath}' -Force`,
      ],
      "Node archive extraction",
    );
  } else {
    requireCommand("tar", ["-xJf", archivePath, "-C", extractPath], "Node archive extraction");
  }

  const sourceBinary = join(extractPath, ...target.binaryRelativePath.split("/"));
  const sourceLicense = join(extractPath, target.platformDirectory, "LICENSE");
  const binaryCheck = spawnSync(sourceBinary, ["--version"], {
    encoding: "utf8",
    windowsHide: process.platform === "win32",
  });
  if (binaryCheck.error || binaryCheck.status !== 0 || binaryCheck.stdout.trim() !== version) {
    throw new Error(`Extracted Node executable does not report ${version}`);
  }

  await mkdir(join(root, "src-tauri", "binaries"), { recursive: true });
  const stagedInfo = await stat(binaryOutput).catch(() => null);
  if (stagedInfo) {
    const stagedBytes = await Bun.file(binaryOutput).bytes();
    const sourceBytes = await Bun.file(sourceBinary).bytes();
    const stagedHash = createHash("sha256").update(stagedBytes).digest("hex");
    const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
    if (stagedHash !== sourceHash) {
      throw new Error("Staged Node executable differs from the verified archive; remove it and rerun preparation");
    }
    const stagedVersion = spawnSync(binaryOutput, ["--version"], {
      encoding: "utf8",
      windowsHide: process.platform === "win32",
    });
    if (stagedVersion.error || stagedVersion.status !== 0 || stagedVersion.stdout.trim() !== version) {
      throw new Error(`Staged Node executable does not report ${version}`);
    }
  } else {
    await copyFile(sourceBinary, binaryOutput);
  }
  if (process.platform === "linux") await chmod(binaryOutput, 0o755);

  const serverEntry = join(outputTree, "server", "index.mjs");
  const publicAssets = join(outputTree, "public");
  const [serverEntryInfo, publicAssetsInfo] = await Promise.all([
    stat(serverEntry).catch(() => null),
    stat(publicAssets).catch(() => null),
  ]);
  if (!serverEntryInfo?.isFile() || !publicAssetsInfo?.isDirectory()) {
    throw new Error("Built .output must contain server/index.mjs and .output/public; run bun run build first");
  }
  await rm(resourceOutput, { recursive: true, force: true });
  await copyTree(outputTree, resourceOutput);
  await copyFile(sourceLicense, join(resourceOutput, "node-LICENSE.txt"));
  console.log(`Prepared verified Node ${version} (${actual.slice(0, 12)}…) and Saber server resources for ${process.platform}/${process.arch}.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
