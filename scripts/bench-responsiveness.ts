import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright";
import { checkSequenceIntegrity, memoryTrend, summarizeSamples } from "../src/lib/responsiveness.ts";

const smoke = process.argv.includes("--smoke");
const durationMs = smoke ? 8_000 : 10 * 60_000;
const port = Number(process.env.SABER_BENCH_PORT ?? 8198);
const root = mkdtempSync(join(tmpdir(), "saber-responsiveness-"));
const dataDir = join(root, "data");
let tasks: Array<{ id: string; title: string }> = [];

let server: ReturnType<typeof spawn> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
try {
  server = spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: process.cwd(), env: { ...process.env, SABER_DATA_DIR: dataDir }, stdio: "ignore", windowsHide: true,
  });
  const url = `http://127.0.0.1:${port}/`;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${url}api/tasks`, { signal: AbortSignal.timeout(2_000) })).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  if (!ready) throw new Error(`Benchmark server did not become ready at ${url}`);
  console.log("isolated server ready");
  for (let i = 0; i < 10; i++) {
    const number = String(i + 1).padStart(2, "0");
    const projectDir = join(root, `synthetic-project-${number}`);
    mkdirSync(projectDir, { recursive: true });
    const created = await fetch(`${url}api/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: projectDir, title: `Benchmark task ${number}`, spec: "Synthetic responsiveness fixture.", criteria: "RBL: keep fixture isolated." }) });
    if (!created.ok) throw new Error(`Failed to create isolated task fixture ${number}: ${await created.text()}`);
    const task = await created.json() as { id: string; title: string };
    const updated = await fetch(`${url}api/tasks/${task.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: `Checkpoint for task ${number}`, draft: `Next action ${i + 1}` }) });
    if (!updated.ok) throw new Error(`Failed to seed context for isolated task ${number}: ${await updated.text()}`);
    tasks.push(task);
  }
  console.log("ten isolated persisted tasks seeded");

  browser = await chromium.launch({ headless: true, args: ["--force-device-scale-factor=1"] });
  console.log("headless Chromium launched");
  const context = await browser.newContext();
  page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") console.log("browser console error:", message.text()); });
  page.on("pageerror", (error) => console.log("browser page error:", error.message));
  await page.addInitScript((selectedTaskId) => {
    localStorage.setItem("saber.selectedTask", selectedTaskId);
    const callbacks = new Map<number, (value: unknown) => void>();
    const listeners = new Map<string, number[]>();
    let next = 1;
    const internals = {
      callbacks,
      transformCallback(callback: (value: unknown) => void) { const id = next++; callbacks.set(id, callback); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      runCallback(id: number, value: unknown) { callbacks.get(id)?.(value); },
      async invoke(command: string, args: Record<string, any> = {}) {
        if (command === "terminal_list") return [];
        if (command === "terminal_start" || command === "terminal_resize" || command === "terminal_write" || command === "terminal_close") return null;
        if (command === "plugin:event|listen") { const group = listeners.get(args.event) ?? []; group.push(args.handler); listeners.set(args.event, group); return args.handler; }
        if (command === "plugin:event|unlisten") { listeners.set(args.event, (listeners.get(args.event) ?? []).filter((id) => id !== args.id)); return null; }
        throw new Error(`Unexpected mocked Tauri command: ${command}`);
      },
    };
    (window as any).__TAURI_INTERNALS__ = internals;
    (window as any).__saberBenchEmit = (event: string, payload: unknown) => {
      for (const id of listeners.get(event) ?? []) internals.runCallback(id, { event, id, payload });
    };
    (window as any).__saberBeginStreams = (terminalIds: string[]) => {
      const sequence = [0, 0, 0];
      const sent: Array<Array<{ sequence: number; marker: string; sentAt: number }>> = [[], [], []];
      const rendered: Array<Array<{ sequence: number; latencyMs: number }>> = [[], [], []];
      const observed = [new Set<number>(), new Set<number>(), new Set<number>()];
      const observer = new MutationObserver(() => {
        for (let stream = 0; stream < 3; stream++) {
          const rows = document.querySelectorAll<HTMLElement>(".xterm-rows")[stream];
          if (!rows) continue;
          const text = rows.textContent ?? "";
          for (const match of text.matchAll(new RegExp(`BENCH-${stream}-(\\d+)`, "g"))) {
            const current = Number(match[1]);
            if (observed[stream]!.has(current)) continue;
            const item = sent[stream]![current - 1];
            if (!item) continue;
            observed[stream]!.add(current);
            rendered[stream]!.push({ sequence: current, latencyMs: performance.now() - item.sentAt });
          }
        }
      });
      for (const rows of document.querySelectorAll(".xterm-rows")) observer.observe(rows, { childList: true, characterData: true, subtree: true });
      const tick = () => terminalIds.forEach((id, stream) => {
        const next = ++sequence[stream]!;
        const marker = `BENCH-${stream}-${next}`;
        const sentAt = performance.now();
        sent[stream]!.push({ sequence: next, marker, sentAt });
        (window as any).__saberBenchEmit(`terminal-output:${id}`, marker + "\r\n");
      });
      tick();
      const timer = window.setInterval(tick, 50);
      return { sequence, sent, rendered, observer, timer };
    };
    (window as any).__saberStopStreams = () => {
      const state = (window as any).__saberBenchStreams;
      if (!state) return null;
      state.observer.disconnect();
      return { sequence: state.sequence, rendered: state.rendered };
    };
    (window as any).__saberPauseStreams = () => {
      const state = (window as any).__saberBenchStreams;
      if (state) window.clearInterval(state.timer);
    };
  }, tasks[0]!.id);
  page.setDefaultTimeout(10_000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log("benchmark page loaded");
  await page.getByRole("button", { name: new RegExp(tasks[0]!.title) }).first().click();
  try { await page.getByRole("heading", { name: tasks[0]!.title }).waitFor(); }
  catch (error) { console.log("initial rendered page text:", (await page.locator("body").innerText()).slice(0, 4000)); throw error; }
  try { await page.getByText(`Checkpoint for task 01`, { exact: true }).waitFor(); }
  catch (error) { console.log("initial rendered page text:", (await page.locator("body").innerText()).slice(0, 4000)); throw error; }
  await page.locator(".xterm").first().waitFor();
  console.log("initial task terminal restored");

  const selectTask = async (taskIndex: number) => {
    const title = tasks[taskIndex]!.title;
    const startedAt = await page!.evaluate((taskTitle) => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>("aside button")).find((candidate) => candidate.textContent?.includes(taskTitle));
      if (!button) throw new Error(`Task selection control is missing: ${taskTitle}`);
      const started = performance.now();
      button.click();
      return started;
    }, title);
    await page!.getByRole("heading", { name: title }).waitFor();
    await page!.getByText(`Checkpoint for task ${String(taskIndex + 1).padStart(2, "0")}`, { exact: true }).waitFor();
    await page!.locator(".xterm").nth(taskIndex).waitFor({ state: "visible" });
    return await page!.evaluate((start) => performance.now() - start, startedAt);
  };

  // Warm all task-owned terminal surfaces once so samples measure switching between restored surfaces.
  for (let i = 1; i < tasks.length; i++) await selectTask(i);
  console.log("all ten terminal surfaces warmed");
  await selectTask(0);
  const selectionSamples: number[] = [];
  for (let i = 0; i < (smoke ? 10 : 200); i++) {
    selectionSamples.push(await selectTask((i % 2) + 1));
    selectionSamples.push(await selectTask(0));
  }
  console.log(`${selectionSamples.length} A/B selection measurements captured`);

  // Output dispatch uses actual xterm listeners. Task restoration latency is measured separately above.
  const terminalIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const response = await page.evaluate(async (id) => await (await fetch(`/api/tasks/${id}/terminals`)).json(), tasks[i]!.id);
    const activeSession = response.find((session: { status: string }) => session.status === "running");
    if (!activeSession) throw new Error(`No mocked terminal session was running for ${tasks[i]!.title}`);
    terminalIds.push(activeSession.id);
  }
  const memorySamples: Array<{ elapsedMs: number; workingSetBytes: number }> = [];
  const memoryProbe = () => Number(execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process chrome-headless-shell | Measure-Object -Property WorkingSet64 -Sum).Sum"], { encoding: "utf8" }).trim());
  memorySamples.push({ elapsedMs: 0, workingSetBytes: memoryProbe() });
  let nextMemorySample = 30_000;
  const streamStart = Date.now();
  await page.evaluate((ids) => { (window as any).__saberBenchStreams = (window as any).__saberBeginStreams(ids); }, terminalIds);
  const streamSamples: number[] = [];
  const renderedSequenceByStream: number[][] = [[], [], []];
  while (Date.now() - streamStart < durationMs) {
    const elapsed = Date.now() - streamStart;
    if (elapsed >= nextMemorySample) {
      memorySamples.push({ elapsedMs: elapsed, workingSetBytes: memoryProbe() });
      nextMemorySample += 30_000;
    }
    await delay(100);
  }
  await page.evaluate(() => (window as any).__saberPauseStreams());
  await delay(1_000);
  const streamState = await page.evaluate(() => (window as any).__saberStopStreams());
  const renderedEvents: Array<Array<{ sequence: number; latencyMs: number }>> = streamState.rendered;
  for (let stream = 0; stream < renderedEvents.length; stream++) {
    renderedSequenceByStream[stream] = renderedEvents[stream]!.map((event) => event.sequence);
    streamSamples.push(...renderedEvents[stream]!.map((event) => event.latencyMs));
  }
  if (streamSamples.length === 0) throw new Error("No synthetic terminal output reached the xterm DOM observer.");
  const sequenceByStream: number[] = streamState.sequence;
  const integrity = sequenceByStream.map((expected, index) => ({ stream: index, ...checkSequenceIntegrity(renderedSequenceByStream[index]!, expected) }));
  const viteVersion = (JSON.parse(readFileSync(join(process.cwd(), "node_modules/vite/package.json"), "utf8")) as { version: string }).version;
  const playwrightVersion = (JSON.parse(readFileSync(join(process.cwd(), "node_modules/playwright/package.json"), "utf8")) as { version: string }).version;
  const report = {
    mode: smoke ? "smoke" : "full",
    command: smoke ? "bun run bench:responsiveness -- --smoke" : "bun run bench:responsiveness",
    host: { os: execFileSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption) + ' ' + (Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Version) + ' ' + $env:PROCESSOR_ARCHITECTURE"], { encoding: "utf8" }).trim(), cpu: execFileSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)"], { encoding: "utf8" }).trim(), memoryBytes: Number(execFileSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"], { encoding: "utf8" }).trim()), displayScale: { deviceScaleFactor: 1, source: "forced by benchmark browser" }, browser: `Chromium ${browser.version()} headless via Playwright ${playwrightVersion}`, runtime: `Node ${process.version}; Vite ${viteVersion}`, appMode: `Vite ${viteVersion} development server under Node; Tauri IPC and PTY mocked` },
    workload: { persistedTasks: tasks.length, warmups: 10, selectionPairs: selectionSamples.length / 2, streamCount: 3, targetEventsPerSecondPerStream: 20, achievedEventsPerSecondPerStream: sequenceByStream.map((count) => count / (durationMs / 1_000)), durationMs, renderedOutputSamples: streamSamples.length },
    selectionLatencyMs: summarizeSamples(selectionSamples),
    outputLatencyMs: summarizeSamples(streamSamples),
    sequenceIntegrity: integrity,
    budgets: { selectionP95Ms: 200, selectionPass: summarizeSamples(selectionSamples).p95 !== null && summarizeSamples(selectionSamples).p95! <= 200, xtermRenderP95Ms: 500, xtermRenderPass: summarizeSamples(streamSamples).p95 !== null && summarizeSamples(streamSamples).p95! <= 500, sequenceIntegrityPass: integrity.every((stream) => stream.dropped.length === 0 && stream.duplicates.length === 0 && stream.outOfOrder.length === 0) },
    memory: { ...memoryTrend(memorySamples), sampleCount: memorySamples.length, intervalMs: 30_000, samples: memorySamples },
    rawSamples: { selectionLatencyMs: selectionSamples, xtermRenderLatencyMs: streamSamples, xtermRenderSequences: renderedSequenceByStream },
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    caveats: ["Synthetic output only; no provider generation or network time.", "Browser task restoration and xterm rendering are real frontend paths. The observer records each owning xterm's DOM updates even while its surface is hidden; task-selection-to-visible restoration is measured separately.", "Tauri IPC, terminal process creation, and OS PTY output source are mocked.", "Memory samples sum headless Chromium processes and are not Saber Tauri/WebView native memory."],
  };
  const receiptPath = smoke ? null : "docs/superpowers/specs/2026-09-23-responsiveness-baseline-verification.json";
  if (receiptPath) writeFileSync(join(process.cwd(), receiptPath), JSON.stringify(report, null, 2));
  const { rawSamples: _rawSamples, ...summary } = report;
  console.log(JSON.stringify({ ...summary, memory: { ...report.memory, samples: undefined }, sequenceIntegrity: integrity.map(({ dropped, duplicates, outOfOrder, ...stream }) => ({ ...stream, droppedCount: dropped.length, duplicateCount: duplicates.length, outOfOrderCount: outOfOrder.length })), receiptPath }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server?.pid) {
    server.kill();
    if (process.platform === "win32") try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  }
  if (process.platform === "win32") try {
    execFileSync("powershell", ["-NoProfile", "-Command", `$listener = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($listener) { $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"; if ($process.CommandLine -like '*vite.js*--port ${port}*') { Stop-Process -Id $listener.OwningProcess -Force } }`], { stdio: "ignore" });
  } catch {}
  rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
}
