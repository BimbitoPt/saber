import { chromium } from "playwright";

export type BrowserState = "idle" | "launching" | "ready" | "failed";

/** Minimal Playwright surface used by the session, so tests can inject fakes. */
export interface BrowserPage {
  on(event: "close" | "crash", listener: () => void): unknown;
  isClosed(): boolean;
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  screenshot(options: { type: "png" }): Promise<Buffer>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  url(): string;
}

export interface BrowserContextLike {
  on(event: "close", listener: () => void): unknown;
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

export interface BrowserInstance {
  on(event: "disconnected", listener: () => void): unknown;
  newContext(options: { viewport: { width: number; height: number } }): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

export interface BrowserSessionDeps {
  launch(options: { headless: boolean }): Promise<BrowserInstance>;
  shutdownTimeoutMs: number;
}

const VIEWPORT = { width: 1280, height: 800 };
const NAVIGATION_TIMEOUT_MS = 20_000;
const NAVIGATION_WAIT = "domcontentloaded" as const;

export class BrowserSession {
  private readonly deps: BrowserSessionDeps;
  private browser: BrowserInstance | null = null;
  private context: BrowserContextLike | null = null;
  private page: BrowserPage | null = null;
  private launching: Promise<BrowserPage> | null = null;
  private current: BrowserState = "idle";
  private closing = false;
  /** Bumped whenever handles are dropped, so an in-flight launch can detect it was superseded. */
  private epoch = 0;

  constructor(deps: BrowserSessionDeps) {
    this.deps = deps;
  }

  state(): BrowserState {
    return this.current;
  }

  ensurePage(): Promise<BrowserPage> {
    if (this.closing) return Promise.reject(new Error("browser session is shutting down"));
    const existing = this.page;
    if (existing && this.browser && !existing.isClosed()) return Promise.resolve(existing);
    if (!this.launching) {
      // A page that closed before its own `close` event arrived still owns a live
      // browser, so the handles are dropped before relaunching to avoid leaking it.
      if (existing) this.handleLost(existing);
      else if (this.browser) this.handleLost(this.browser);
      const epoch = this.epoch;
      this.launching = this.launchPage(epoch).finally(() => {
        this.launching = null;
      });
    }
    return this.launching;
  }

  async goto(url: string): Promise<void> {
    const page = await this.ensurePage();
    try {
      await page.goto(url, { waitUntil: NAVIGATION_WAIT, timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      this.dropIfDead(page);
      throw error;
    }
  }

  async screenshot(): Promise<Buffer> {
    const page = await this.ensurePage();
    try {
      return await page.screenshot({ type: "png" });
    } catch (error) {
      this.dropIfDead(page);
      throw error;
    }
  }

  async act(action: string, target: string, value?: string): Promise<void> {
    const page = await this.ensurePage();
    try {
      if (action === "click") await page.click(target);
      else if (action === "type") await page.fill(target, value ?? "");
      else throw new Error(`unknown action: ${action}`);
    } catch (error) {
      this.dropIfDead(page);
      throw error;
    }
  }

  async currentUrl(): Promise<string> {
    const page = await this.ensurePage();
    return page.url();
  }

  /** Bounded, and it clears every reference even when the browser refuses to close. */
  async shutdown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    try {
      const browser = this.browser;
      if (browser) await this.closeQuiet(browser);
    } finally {
      this.release();
      this.current = "idle";
      this.closing = false;
    }
  }

  private async launchPage(epoch: number): Promise<BrowserPage> {
    this.current = "launching";
    let browser: BrowserInstance;
    try {
      browser = await this.deps.launch({ headless: true });
    } catch (error) {
      // A launcher that never produced a handle must not leave the session stuck on "launching".
      if (epoch === this.epoch) this.current = "failed";
      throw error;
    }
    try {
      this.assertCurrent(epoch);
      this.browser = browser;
      browser.on("disconnected", () => this.handleLost(browser));
      const context = await browser.newContext({ viewport: VIEWPORT });
      this.assertCurrent(epoch);
      this.context = context;
      const page = await context.newPage();
      this.assertCurrent(epoch);
      this.page = page;
      page.on("close", () => this.handleLost(page));
      page.on("crash", () => this.handleLost(page));
      this.current = "ready";
      return page;
    } catch (error) {
      // A partial launch must not leak the handle it already created.
      const superseded = epoch !== this.epoch;
      await this.closeQuiet(browser);
      this.clearHandles();
      if (!superseded) this.current = "failed";
      throw error;
    }
  }

  private assertCurrent(epoch: number): void {
    if (epoch !== this.epoch) throw new Error("browser launch superseded");
  }

  /** A disconnected browser or a closed/crashed page resets state so the next ensurePage() relaunches. */
  private handleLost(handle: BrowserPage | BrowserInstance): void {
    if (this.closing) return;
    if (handle !== this.page && handle !== this.browser) return;
    const browser = this.browser;
    this.release();
    this.current = "idle";
    if (browser) void this.closeQuiet(browser);
  }

  private dropIfDead(page: BrowserPage): void {
    if (page.isClosed()) this.handleLost(page);
  }

  private release(): void {
    this.epoch += 1;
    this.clearHandles();
  }

  private clearHandles(): void {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  private async closeQuiet(browser: BrowserInstance): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.deps.shutdownTimeoutMs);
    });
    const closing = (async () => {
      try {
        await browser.close();
      } catch {
        /* already gone, or refusing to close: the caller clears the handle anyway */
      }
    })();
    try {
      await Promise.race([closing, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function createBrowserSession(overrides: Partial<BrowserSessionDeps> = {}): BrowserSession {
  const deps: BrowserSessionDeps = {
    launch: (options) => chromium.launch(options),
    shutdownTimeoutMs: 5_000,
    ...overrides,
  };
  return new BrowserSession(deps);
}

const defaultSession = createBrowserSession();

export function ensurePage(): Promise<BrowserPage> {
  return defaultSession.ensurePage();
}

export function goto(url: string): Promise<void> {
  return defaultSession.goto(url);
}

export function screenshot(): Promise<Buffer> {
  return defaultSession.screenshot();
}

export function act(action: string, target: string, value?: string): Promise<void> {
  return defaultSession.act(action, target, value);
}

export function currentUrl(): Promise<string> {
  return defaultSession.currentUrl();
}

export function shutdown(): Promise<void> {
  return defaultSession.shutdown();
}
