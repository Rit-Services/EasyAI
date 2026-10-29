const { prisma } = require('../../db/db');
const config = require('../../config');
const emailService = require('../email/emailService');
const logger = require('../../utils/logger');

// Emails the platform operator (config.email.communityNotify) about a new
// community discussion or reply, so it can be reviewed and removed if needed.
// Fire-and-forget: it never delays or fails the post itself; a failed send is
// only logged.
function notifyNewCommunityPost({ kind, thread, body, user }) {
  const to = config.email.communityNotify;
  if (!to) return;
  (async () => {
    const org = user.organizationId
      ? await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { name: true } })
      : null;
    await emailService.sendCommunityPostEmail(to, {
      kind,
      thread,
      body,
      author: { fullName: user.fullName, email: user.email },
      orgName: org?.name,
      link: `${config.clientUrl}/community/${thread.id}`,
    });
  })().catch((err) => logger.warn(`community: moderation email for ${kind} on thread ${thread.id} failed`, err.message));
}

module.exports = { notifyNewCommunityPost };
