import { expect, test } from '@playwright/test';
import { loginAs, submitLaptopRequest, unique } from './helpers';

test('employee submits, manager approves, and the employee sees it live', async ({ browser }) => {
  const title = unique('Laptop for Emma');
  const emma = await loginAs(browser, 'emma');
  await submitLaptopRequest(emma, title);
  await expect(emma.getByText('In progress', { exact: true }).first()).toBeVisible();
  await expect(emma.getByText('Maria Chen')).toBeVisible();

  const maria = await loginAs(browser, 'maria');
  await maria.getByRole('link', { name: new RegExp(title) }).click();
  await maria.getByRole('button', { name: 'Approve' }).click();
  await expect(maria.getByText('Approved', { exact: true }).first()).toBeVisible();

  // Emma's page was never reloaded: the WebSocket notice made it refetch.
  await expect(emma.getByText('Approved', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(emma.getByText('request approved')).toBeVisible();
});

test('approver sends back, requester fixes and resubmits', async ({ browser }) => {
  const title = unique('Laptop for Noah');
  const noah = await loginAs(browser, 'noah');
  await submitLaptopRequest(noah, title);

  const maria = await loginAs(browser, 'maria');
  await maria.getByRole('link', { name: new RegExp(title) }).click();

  // A comment is required to send back; the form says so before calling the API.
  await maria.getByRole('button', { name: 'Send back' }).click();
  await expect(maria.getByText(/Please explain why in a comment/)).toBeVisible();
  await maria.getByLabel('Comment').fill('Please add the model number.');
  await maria.getByRole('button', { name: 'Send back' }).click();
  await expect(maria.getByText('Changes requested', { exact: true }).first()).toBeVisible();

  await noah.reload();
  await expect(noah.getByText('Please add the model number.').first()).toBeVisible();
  await noah.getByLabel('Why do you need it?').fill('Model: MacBook Air M4, 16 GB.');
  await noah.getByRole('button', { name: 'Resubmit' }).click();
  await expect(noah.getByText('In progress', { exact: true }).first()).toBeVisible();
  await expect(noah.getByText('resubmitted with changes')).toBeVisible();
});
