import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { BrowserContextLike, BrowserInstance, BrowserPage } from "./browser";
import { createBrowserSession } from "./browser";
import { shutdownResources } from "../server";

class FakePage extends EventEmitter implements BrowserPage {
  closed = false;

  async goto(): Promise<null> {
    return null;
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from("png");
  }

  async click(): Promise<void> {}

  async fill(): Promise<void> {}

  url(): string {
    return "http://localhost:8090/";
  }

  isClosed(): boolean {
    return this.closed;
  }
}

class FakeContext extends EventEmitter implements BrowserContextLike {
  readonly page = new FakePage();
  closes = 0;

  async newPage(): Promise<BrowserPage> {
    return this.page;
  }

  async close(): Promise<void> {
    this.closes += 1;
  }
}

class FakeBrowser extends EventEmitter implements BrowserInstance {
  contexts: FakeContext[] = [];
  closes = 0;
  failContext = false;
  failClose = false;

  async newContext(): Promise<BrowserContextLike> {
    if (this.failContext) throw new Error("context failed");
    const context = new FakeContext();
    this.contexts.push(context);
    return context;
  }

  async close(): Promise<void> {
    this.closes += 1;
    if (this.failClose) throw new Error("close refused");
  }
}

function queuedLauncher(browsers: FakeBrowser[]) {
  let index = 0;
  return vi.fn(async () => browsers[Math.min(index++, browsers.length - 1)]);
}

describe("verification browser lifecycle", () => {
  it("PROC-04 launches once for concurrent callers and reports ready", async () => {
    const browser = new FakeBrowser();
    const launch = queuedLauncher([browser]);
    const session = createBrowserSession({ launch });

    const [first, second] = await Promise.all([session.ensurePage(), session.ensurePage()]);

    expect(first).toBe(second);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(session.state()).toBe("ready");
  });

  it("PROC-04 relaunches after the browser disconnects", async () => {
    const [first, second] = [new FakeBrowser(), new FakeBrowser()];
    const launch = queuedLauncher([first, second]);
    const session = createBrowserSession({ launch });
    const page = await session.ensurePage();

    first.emit("disconnected");

    expect(session.state()).toBe("idle");
    const relaunched = await session.ensurePage();
    expect(relaunched).not.toBe(page);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(session.state()).toBe("ready");
  });

  it("PROC-04 relaunches after the page closes or crashes", async () => {
    const closed = new FakeBrowser();
    const closedSession = createBrowserSession({ launch: queuedLauncher([closed, new FakeBrowser()]) });
    const closedPage = (await closedSession.ensurePage()) as FakePage;
    closedPage.closed = true;
    closedPage.emit("close");

    expect(closedSession.state()).toBe("idle");
    expect(await closedSession.ensurePage()).not.toBe(closedPage);

    const crashed = new FakeBrowser();
    const crashedSession = createBrowserSession({ launch: queuedLauncher([crashed, new FakeBrowser()]) });
    const crashedPage = (await crashedSession.ensurePage()) as FakePage;
    crashedPage.emit("crash");

    expect(crashedSession.state()).toBe("idle");
    expect(await crashedSession.ensurePage()).not.toBe(crashedPage);
  });

  it("PROC-04 drops a page that closed before its event so the old browser is not leaked", async () => {
    const [first, second] = [new FakeBrowser(), new FakeBrowser()];
    const launch = queuedLauncher([first, second]);
    const session = createBrowserSession({ launch });

    const page = (await session.ensurePage()) as FakePage;
    // The page went away but its `close` event never arrived.
    page.closed = true;

    expect(await session.ensurePage()).not.toBe(page);
    expect(first.closes).toBe(1);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(session.state()).toBe("ready");
  });

  it("PROC-04 closes the handle it already created when a launch fails partway", async () => {
    const broken = new FakeBrowser();
    broken.failContext = true;
    const healthy = new FakeBrowser();
    const launch = queuedLauncher([broken, healthy]);
    const session = createBrowserSession({ launch });

    await expect(session.ensurePage()).rejects.toThrow("context failed");

    expect(session.state()).toBe("failed");
    expect(broken.closes).toBe(1);

    const page = await session.ensurePage();
    expect(page).toBe(healthy.contexts[0].page);
    expect(session.state()).toBe("ready");
  });

  it("PROC-04 reports failed when the launcher itself rejects", async () => {
    const launch = vi.fn(async () => {
      throw new Error("no chromium");
    });
    const session = createBrowserSession({ launch });

    await expect(session.ensurePage()).rejects.toThrow("no chromium");

    expect(session.state()).toBe("failed");
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("PROC-04 ignores events from a browser it no longer owns", async () => {
    const stale = new FakeBrowser();
    const current = new FakeBrowser();
    const session = createBrowserSession({ launch: queuedLauncher([stale, current]) });

    await session.ensurePage();
    stale.emit("disconnected");
    await session.ensurePage();
    stale.emit("disconnected");

    expect(session.state()).toBe("ready");
    expect(current.closes).toBe(0);
  });

  it("PROC-05 clears every reference even when close rejects", async () => {
    const browser = new FakeBrowser();
    browser.failClose = true;
    const next = new FakeBrowser();
    const launch = queuedLauncher([browser, next]);
    const session = createBrowserSession({ launch, shutdownTimeoutMs: 50 });

    await session.ensurePage();
    await session.shutdown();

    expect(browser.closes).toBe(1);
    expect(session.state()).toBe("idle");

    browser.emit("disconnected");

    expect(session.state()).toBe("idle");
    expect(await session.ensurePage()).toBe(next.contexts[0].page);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("PROC-05 bounds a shutdown whose close never resolves", async () => {
    const browser = new FakeBrowser();
    browser.close = () => new Promise<void>(() => {});
    const next = new FakeBrowser();
    const launch = queuedLauncher([browser, next]);
    const session = createBrowserSession({ launch, shutdownTimeoutMs: 20 });

    await session.ensurePage();
    await session.shutdown();

    expect(session.state()).toBe("idle");
    expect(await session.ensurePage()).toBe(next.contexts[0].page);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("PROC-05 shutdown without a browser and a second shutdown are no-ops", async () => {
    const session = createBrowserSession({ launch: queuedLauncher([new FakeBrowser()]) });

    await session.shutdown();
    await session.shutdown();
    await session.ensurePage();
    await session.shutdown();

    expect(session.state()).toBe("idle");
  });

  it("PROC-05 server shutdown reconciles, stops dev servers, then shuts the browser down", async () => {
    const calls: string[] = [];

    await shutdownResources({
      reconcile: () => {
        calls.push("reconcile");
        return [];
      },
      stopAll: async () => {
        calls.push("stopAll");
      },
      shutdownBrowser: async () => {
        calls.push("shutdownBrowser");
      },
    });

    expect(calls).toEqual(["reconcile", "stopAll", "shutdownBrowser"]);
  });

  it("PROC-05 server shutdown still runs the browser step when a dev server step fails", async () => {
    const calls: string[] = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await shutdownResources({
        reconcile: () => {
          throw new Error("reconcile failed");
        },
        stopAll: async () => {
          calls.push("stopAll");
        },
        shutdownBrowser: async () => {
          calls.push("shutdownBrowser");
        },
      });

      expect(calls).toEqual(["stopAll", "shutdownBrowser"]);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
