import { expect, test } from '@playwright/test';
import { loginAs, unique } from './helpers';

test('admin creates, checks and publishes a workflow that employees can then use', async ({
  browser,
}) => {
  const name = unique('Training budget');
  const alex = await loginAs(browser, 'alex');
  await alex.getByRole('link', { name: 'Workflows' }).click();
  await alex.getByLabel('Name').fill(name);
  await alex.getByRole('button', { name: 'Create and open builder' }).click();

  // The starter design is valid; adding an unconnected condition is flagged at once.
  await expect(alex.getByRole('heading', { name })).toBeVisible();
  await expect(alex.getByText('No problems found.')).toBeVisible();
  await alex.getByRole('button', { name: '+ Condition' }).click();
  await expect(alex.getByText(/Problems \(\d+\)/)).toBeVisible();
  await expect(alex.getByRole('button', { name: 'Publish' })).toBeDisabled();

  await alex.getByRole('button', { name: 'Delete step' }).click();
  await expect(alex.getByText('No problems found.')).toBeVisible();
  await alex.getByRole('button', { name: 'Publish' }).click();
  await expect(alex.getByText('Version 1 is live')).toBeVisible();
  await expect(alex.getByText('Live v1')).toBeVisible();

  const emma = await loginAs(browser, 'emma');
  await emma.getByRole('link', { name: 'My requests' }).click();
  await emma.getByRole('link', { name: 'New request' }).click();
  await expect(emma.getByRole('button', { name: new RegExp(name) })).toBeVisible();
});

test('employees cannot open admin pages', async ({ browser }) => {
  const emma = await loginAs(browser, 'emma');
  await expect(emma.getByRole('link', { name: 'Workflows' })).toHaveCount(0);
  const orgPath = new URL(emma.url()).pathname.replace(/\/inbox$/, '');
  for (const page of ['workflows', 'members', 'audit', 'dashboard']) {
    await emma.goto(`${orgPath}/${page}`);
    await expect(emma.getByText('Only admins can open this page.')).toBeVisible();
  }
});
