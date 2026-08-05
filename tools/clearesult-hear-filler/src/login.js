// Step 1 — log in ONCE. Opens the portal in a persistent profile, then waits.
// Log in by hand (email + password + CAPTCHA), get to the logged-in home,
// then press Enter here. Your session is saved to .browser-profile and reused
// by inspect/fill — you won't have to log in again unless it expires.
import readline from 'node:readline';
import { launch } from './browser.js';
import { settings } from '../config/settings.js';

const { context, page } = await launch();
await page.goto(settings.baseUrl, { waitUntil: 'domcontentloaded' });

console.log('\n=== ClearResult HEAR filler — login ===');
console.log('A browser window is open. Log in manually (email, password, CAPTCHA).');
console.log('Navigate until you are fully logged in and can see your dashboard.');
console.log('Then come back here and press Enter to save the session.\n');

await new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Press Enter once you are logged in... ', () => { rl.close(); resolve(); });
});

console.log('Session saved to', settings.userDataDir);
console.log('You can close the window. Next: `npm run inspect` on a reservation page.');
await context.close();
process.exit(0);
