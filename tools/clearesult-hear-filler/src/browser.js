// Shared browser launcher — persistent profile so login survives across runs.
import { chromium } from 'playwright';
import { settings } from '../config/settings.js';

export async function launch() {
  const context = await chromium.launchPersistentContext(settings.userDataDir, {
    headless: settings.headless,
    slowMo: settings.slowMo,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  context.setDefaultTimeout(settings.fieldTimeout);
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}
