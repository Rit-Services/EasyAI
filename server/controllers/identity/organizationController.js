const { prisma } = require('../../db/db');
const ErrorResponse = require('../../utils/errorResponse');
const { recordAudit } = require('../../utils/audit');
const logger = require('../../utils/logger');
const { clientIp } = require('../../utils/clientIp');
const emailService = require('../../services/email/emailService');
const { avvPdfPath, CURRENT_AVV_VERSION, getAvvPdfBuffer } = require('../../services/avv/avvService');

// GET /api/organizations/current
async function getCurrent(req, res) {
  if (!req.organizationId) throw new ErrorResponse('No organization for this account', 404);
  const org = await prisma.organization.findUnique({ where: { id: req.organizationId } });
  res.json({ organization: org });
}

// PATCH /api/organizations/current
async function updateCurrent(req, res) {
  if (!req.organizationId) throw new ErrorResponse('No organization for this account', 404);
  const org = await prisma.organization.update({
    where: { id: req.organizationId },
    data: req.body,
  });
  await recordAudit({ req, action: 'organization.update', entityType: 'Organization', entityId: org.id, after: req.body });
  res.json({ organization: org });
}

// PATCH /api/organizations/current/functions
// Saves the "what does your company do?" answers from the Law Explorer.
// Any member may set this (it drives their personalised applicability view).
async function updateFunctions(req, res) {
  if (!req.organizationId) throw new ErrorResponse('No organization for this account', 404);
  const org = await prisma.organization.update({
    where: { id: req.organizationId },
    data: { selectedFunctions: req.body.selectedFunctions },
  });
  res.json({ organization: org });
}

// GET /api/organizations/current/members
async function listMembers(req, res) {
  if (!req.organizationId) throw new ErrorResponse('No organization for this account', 404);
  const members = await prisma.user.findMany({
    where: { organizationId: req.organizationId },
    select: { id: true, fullName: true, email: true, role: true, emailVerifiedAt: true, lastLoginAt: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ members });
}

// GET /api/organizations/current/avv
// The AVV (Art. 28 GDPR data processing agreement) accepted at registration.
// Any org member may view this, it is a record of the organisation's own
// agreement, not sensitive in the way member/billing data is.
async function getAvv(req, res) {
  if (!req.organizationId) throw new ErrorResponse('No organization for this account', 404);
  const acceptance = await prisma.avvAcceptance.findFirst({
    where: { organizationId: req.organizationId, supersededAt: null },
    orderBy: { acceptedAt: 'desc' },
  });
  if (!acceptance) throw new ErrorResponse('No Data Processing Agreement acceptance found for this organization', 404);
  res.json({
    avv: {
      version: acceptance.version,
      acceptedAt: acceptance.acceptedAt,
      acceptedByName: acceptance.acceptedByName,
      acceptedByRole: acceptance.acceptedByRole,
    },
  });
}

// GET /api/organizations/current/avv/pdf
// Section 5.2: "Der Kunde kann die Vereinbarung ... jederzeit vollstaendig
// als PDF-Datei aus den Organisationseinstellungen der Plattform
// herunterladen." Always serves the version this organisation actually
// accepted, not necessarily the latest one published, so an older
// acceptance stays exactly reconstructable (Section 18a).
async function avvPdf(req, res) {
  if (!req.organizationId) throw new ErrorResponse('No organization for this account', 404);
  const acceptance = await prisma.avvAcceptance.findFirst({
    where: { organizationId: req.organizationId, supersededAt: null },
    orderBy: { acceptedAt: 'desc' },
  });
  if (!acceptance) throw new ErrorResponse('No Data Processing Agreement acceptance found for this organization', 404);
  const filePath = avvPdfPath(acceptance.version);
  if (!filePath) throw new ErrorResponse('The accepted Data Processing Agreement version is no longer available', 404);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="avv-compliance-check-v${acceptance.version}.pdf"`);
  res.sendFile(filePath);
}

// POST /api/organizations/current/avv  { organizationAddress, organizationLegalForm?, avvAccepted: true }
// For organisations created before AVV acceptance became part of registration,
// and for test accounts switching to production: records the acceptance exactly
// as registration does (version, who accepted in which role, company details,
// IP, user agent), then emails the signed copy.
async function acceptAvv(req, res) {
  if (!req.organizationId) throw new ErrorResponse('No organization for this account', 404);
  const existing = await prisma.avvAcceptance.findFirst({
    where: { organizationId: req.organizationId, supersededAt: null },
  });
  if (existing) throw new ErrorResponse('The Data Processing Agreement has already been accepted for this organization', 409);

  const { organizationAddress, organizationLegalForm } = req.body;
  const user = req.user;
  const { org, acceptance } = await prisma.$transaction(async (tx) => {
    const updated = await tx.organization.update({
      where: { id: req.organizationId },
      data: {
        address: organizationAddress,
        ...(organizationLegalForm !== undefined ? { legalForm: organizationLegalForm || null } : {}),
        // Accepting the AVV makes a test account a regular one, without its limits.
        accountType: 'production',
      },
    });
    const created = await tx.avvAcceptance.create({
      data: {
        organizationId: updated.id,
        version: CURRENT_AVV_VERSION,
        acceptedByUserId: user.id,
        acceptedByName: user.fullName,
        acceptedByRole: user.role,
        acceptedByEmail: user.email,
        companyName: updated.name,
        companyLegalForm: updated.legalForm,
        companyAddress: updated.address,
        ip: clientIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      },
    });
    return { org: updated, acceptance: created };
  });
  await recordAudit({ req, action: 'avv.accepted', entityType: 'Organization', entityId: org.id, after: { version: CURRENT_AVV_VERSION } });

  // Best-effort, as at registration: the acceptance is recorded and
  // downloadable from Settings even if the email fails.
  try {
    const pdfBuffer = getAvvPdfBuffer(CURRENT_AVV_VERSION);
    if (pdfBuffer) await emailService.sendAvvSignedEmail(user, org, CURRENT_AVV_VERSION, pdfBuffer);
  } catch (err) {
    logger.warn('AVV signed-copy email failed to send', err.message);
  }

  res.status(201).json({
    avv: {
      version: acceptance.version,
      acceptedAt: acceptance.acceptedAt,
      acceptedByName: acceptance.acceptedByName,
      acceptedByRole: acceptance.acceptedByRole,
    },
  });
}

module.exports = {
  getCurrent, updateCurrent, updateFunctions, listMembers, getAvv, avvPdf, acceptAvv,
};
