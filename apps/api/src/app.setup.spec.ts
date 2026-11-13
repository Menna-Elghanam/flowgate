import { redactUrl } from './app.setup';

describe('redactUrl', () => {
  it('hides invite tokens', () => {
    expect(redactUrl('/invites/abc123_-XYZ')).toBe('/invites/[redacted]');
    expect(redactUrl('/invites/abc123/accept')).toBe('/invites/[redacted]/accept');
    expect(redactUrl('/invites/abc123?x=1')).toBe('/invites/[redacted]?x=1');
  });

  it('keeps invite management URLs readable', () => {
    // Listing invites has no token in the URL, so the log line stays as it is.
    expect(redactUrl('/orgs/o1/invites')).toBe('/orgs/o1/invites');
    expect(redactUrl('/orgs/o1/requests/r1')).toBe('/orgs/o1/requests/r1');
  });
});
