import path from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'flowgate-demo';

export const PEOPLE = ['alex', 'maria', 'emma', 'noah'] as const;
export type Person = (typeof PEOPLE)[number];

export const sessionFile = (name: Person) => path.join(__dirname, '.auth', `${name}.json`);

/**
 * Opens the app as a person, reusing the session saved by auth.setup.ts. Each person gets
 * their own browser context, so two people can act side by side in one test.
 */
export async function loginAs(browser: Browser, name: Person): Promise<Page> {
  const context = await browser.newContext({ storageState: sessionFile(name) });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/o\/[^/]+\/inbox$/);
  return page;
}

export const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

/** Submits a laptop request under the $1,500 Finance limit, so only the manager decides. */
export async function submitLaptopRequest(page: Page, title: string): Promise<void> {
  await page.getByRole('link', { name: 'My requests' }).click();
  await page.getByRole('link', { name: 'New request' }).click();
  await page.getByRole('button', { name: /Laptop request/ }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Model').selectOption('MacBook Air');
  await page.getByLabel('Cost (USD)').fill('1200');
  await page.getByLabel('Why do you need it?').fill('My current laptop is five years old.');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}
