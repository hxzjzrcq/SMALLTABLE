import { chromium, type Page } from 'playwright';

export function launchBrowser(args: string[] = []) {
  return chromium.launch({
    headless: true,
    executablePath: process.env.SMALLTABLE_CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', ...args],
  });
}

/** Only submit the form; each scenario owns navigation and readiness checks. */
export async function submitLogin(page: Page, name: string, password: string) {
  await page.locator('#st-login-name').fill(name);
  await page.locator('#st-login-password').fill(password);
  await page.getByRole('button', { name: '进入房间', exact: true }).click();
}
