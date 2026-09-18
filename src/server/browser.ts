import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let launching: Promise<Page> | null = null;

async function launchPage(): Promise<Page> {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  return page;
}

export async function ensurePage(): Promise<Page> {
  if (page) return page;
  launching ??= launchPage().catch((error) => {
    launching = null;
    throw error;
  });
  return launching;
}

export async function goto(url: string): Promise<void> {
  const p = await ensurePage();
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
}

export async function screenshot(): Promise<Buffer> {
  const p = await ensurePage();
  return p.screenshot({ type: "png" });
}

export async function act(action: string, target: string, value?: string): Promise<void> {
  const p = await ensurePage();
  if (action === "click") await p.click(target);
  else if (action === "type") await p.fill(target, value ?? "");
  else throw new Error(`unknown action: ${action}`);
}

export async function currentUrl(): Promise<string> {
  const p = await ensurePage();
  return p.url();
}

export async function shutdown(): Promise<void> {
  if (browser) await browser.close().catch(() => {});
  browser = null;
  context = null;
  page = null;
  launching = null;
}
