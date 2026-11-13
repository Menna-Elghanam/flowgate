import { readCookie } from '../realtime/realtime.gateway';
import { renderEmail } from './templates';

describe('renderEmail', () => {
  it('greets the recipient and links to the request', () => {
    const email = renderEmail(
      'task_assigned',
      {
        requestTitle: 'New laptop',
        requesterName: 'Emma',
        stepName: 'Manager approval',
        requestUrl: 'http://x/r/1',
      },
      'Maria',
    );
    expect(email.subject).toBe('Approval needed: New laptop');
    expect(email.text).toContain('Hi Maria,');
    expect(email.text).toContain('Open request: http://x/r/1');
  });

  it('escapes user content in the HTML version', () => {
    const email = renderEmail('changes_requested', {
      requestTitle: '<script>alert(1)</script>',
      stepName: 'Finance',
      comment: 'a & b',
      requestUrl: 'http://x',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('a &amp; b');
  });
});

describe('readCookie', () => {
  it('finds a cookie among several and decodes it', () => {
    expect(readCookie('a=1; fg_session=abc%3D; b=2', 'fg_session')).toBe('abc=');
    expect(readCookie(undefined, 'fg_session')).toBeUndefined();
    expect(readCookie('other=1', 'fg_session')).toBeUndefined();
  });
});
