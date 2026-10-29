const config = require('../config');
const { buildCommunityPostEmail } = require('../services/email/emailService');

const base = {
  thread: { id: 't-1', title: 'Does the AI Act cover chatbots?', visibility: 'global' },
  author: { fullName: 'Jane Doe', email: 'jane@example.com' },
  orgName: 'Example GmbH',
  link: 'https://compliance.example/community/t-1',
};

describe('community moderation email', () => {
  it('names the poster, the discussion and links to it', () => {
    const mail = buildCommunityPostEmail({ ...base, kind: 'thread', body: 'Our support bot answers customers.' });
    expect(mail.subject).toBe('New discussion in the Community: Does the AI Act cover chatbots?');
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain('Jane Doe');
      expect(part).toContain('jane@example.com');
      expect(part).toContain('Example GmbH');
      expect(part).toContain('Our support bot answers customers.');
      expect(part).toContain(base.link);
    }
    expect(mail.text).toContain('Visible to all Community users');
  });

  it('labels replies and organisation-only discussions', () => {
    const mail = buildCommunityPostEmail({
      ...base, kind: 'reply', body: 'Yes.', thread: { ...base.thread, visibility: 'org' },
    });
    expect(mail.subject).toMatch(/^New reply in the Community: /);
    expect(mail.text).toContain("Only visible to the poster's organisation");
  });

  it('escapes user-written text in the HTML', () => {
    const mail = buildCommunityPostEmail({
      ...base,
      kind: 'thread',
      thread: { ...base.thread, title: '<img src=x onerror=alert(1)>' },
      body: '<script>alert("x")</script>',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('shortens very long posts and keeps the subject short', () => {
    const mail = buildCommunityPostEmail({
      ...base, kind: 'thread', thread: { ...base.thread, title: 'T'.repeat(300) }, body: 'a'.repeat(5000),
    });
    expect(mail.subject.length).toBeLessThan(160);
    expect(mail.text).toContain(`${'a'.repeat(2000)}…`);
    expect(mail.text).not.toContain('a'.repeat(2001));
  });

  it('is off outside production unless an address is configured', () => {
    // NODE_ENV is "test" here and COMMUNITY_NOTIFY_EMAIL is unset.
    if (process.env.COMMUNITY_NOTIFY_EMAIL === undefined) expect(config.email.communityNotify).toBe('');
  });
});
