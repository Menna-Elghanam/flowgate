import type { EmailTemplate } from '../core/effects/effects';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

interface Parts {
  subject: string;
  lines: string[];
  action?: { label: string; url: string };
}

function parts(template: EmailTemplate, v: Record<string, string>): Parts {
  const open = { label: 'Open request', url: v.requestUrl ?? '' };
  switch (template) {
    case 'invite':
      return {
        subject: `You're invited to ${v.orgName} on Flowgate`,
        lines: [`${v.inviterName} invited you to join ${v.orgName} on Flowgate.`],
        action: { label: 'Accept invite', url: v.inviteUrl ?? '' },
      };
    case 'task_assigned':
      return {
        subject: `Approval needed: ${v.requestTitle}`,
        lines: [
          `${v.requesterName}'s request "${v.requestTitle}" is waiting for you at "${v.stepName}".`,
        ],
        action: open,
      };
    case 'task_reminder':
      return {
        subject: `Reminder: ${v.requestTitle} is waiting for you`,
        lines: [
          `"${v.requestTitle}" is still waiting for your decision at "${v.stepName}".`,
          `It escalates if not decided by ${v.dueAt ? new Date(v.dueAt).toUTCString() : 'the deadline'}.`,
        ],
        action: open,
      };
    case 'task_escalated':
      return {
        subject: `Escalated to you: ${v.requestTitle}`,
        lines: [
          `"${v.requestTitle}" from ${v.requesterName} passed its deadline at "${v.stepName}" and is now waiting for you.`,
        ],
        action: open,
      };
    case 'changes_requested':
      return {
        subject: `Changes requested: ${v.requestTitle}`,
        lines: [
          `Your request "${v.requestTitle}" was sent back at "${v.stepName}".`,
          `Comment: ${v.comment}`,
        ],
        action: { label: 'Update request', url: v.requestUrl ?? '' },
      };
    case 'request_completed':
      return {
        subject: `${v.outcome === 'approved' ? 'Approved' : 'Rejected'}: ${v.requestTitle}`,
        lines: [`Your request "${v.requestTitle}" was ${v.outcome}.`],
        action: open,
      };
  }
}

export function renderEmail(
  template: EmailTemplate,
  vars: Record<string, string>,
  recipientName?: string,
): RenderedEmail {
  const { subject, lines, action } = parts(template, vars);
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi,';
  const text = [
    greeting,
    '',
    ...lines,
    ...(action ? ['', `${action.label}: ${action.url}`] : []),
  ].join('\n');
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    action ? `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>` : '',
    '<p style="color:#6b7280;font-size:12px">Sent by Flowgate</p>',
  ].join('\n');
  return { subject, text, html };
}
