import { expect, test as setup } from '@playwright/test';
import { DEMO_PASSWORD, PEOPLE, sessionFile } from './helpers';

// Log each demo person in once and save their session cookie. Tests reuse these files,
// so a run makes only a few login calls and stays under the API's login rate limit.
for (const name of PEOPLE) {
  setup(`log in as ${name}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(`${name}@acme.test`);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/o\/[^/]+\/inbox$/);
    await page.context().storageState({ path: sessionFile(name) });
  });
}
