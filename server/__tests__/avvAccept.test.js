const { installFakeDb } = require('./helpers/fakeDb');

// Accepting the AVV from Settings, for organisations that registered before
// acceptance was part of sign-up. Same fake-Prisma approach as authRegister.
const state = {};

function makeTx() {
  return {
    organization: {
      update: async ({ where, data }) => {
        const org = state.orgs.find((o) => o.id === where.id);
        Object.assign(org, data);
        return { ...org };
      },
    },
    avvAcceptance: {
      create: async ({ data }) => {
        const rec = { id: `avv-${state.avvAcceptances.length + 1}`, acceptedAt: new Date('2026-10-30T10:00:00Z'), ...data };
        state.avvAcceptances.push(rec);
        return rec;
      },
    },
  };
}

installFakeDb({
  avvAcceptance: {
    findFirst: async ({ where }) => state.avvAcceptances.find(
      (a) => a.organizationId === where.organizationId && !a.supersededAt,
    ) || null,
  },
  $transaction: async (cb) => cb(makeTx()),
  auditLog: { create: async (args) => { state.audits.push(args.data.action); return {}; } },
});

const { acceptAvv } = require('../controllers/identity/organizationController');
const emailService = require('../services/email/emailService');

const OWNER = { id: 'user-1', fullName: 'Matthias W', email: 'mw@example.com', role: 'owner', organizationId: 'org-1' };

function setup() {
  state.orgs = [{ id: 'org-1', name: 'Legacy GmbH', legalForm: null, address: null }];
  state.avvAcceptances = [];
  state.audits = [];
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const req = (body, user = OWNER) => ({
  body, user, organizationId: user.organizationId, headers: { 'user-agent': 'vitest-agent' }, ip: '203.0.113.5',
});

const BODY = { organizationAddress: 'Musterstraße 1, 50667 Köln', organizationLegalForm: 'GmbH', avvAccepted: true };

describe('accept the AVV after registration', () => {
  beforeEach(setup);

  it('records the acceptance like registration does and updates the company details', async () => {
    const spy = vi.spyOn(emailService, 'sendAvvSignedEmail').mockResolvedValue({ messageId: 'm-1' });
    const res = fakeRes();
    await acceptAvv(req(BODY), res);

    expect(res.statusCode).toBe(201);
    expect(state.avvAcceptances).toHaveLength(1);
    const a = state.avvAcceptances[0];
    expect(a).toMatchObject({
      organizationId: 'org-1', version: '1.1', acceptedByUserId: 'user-1', acceptedByName: 'Matthias W',
      acceptedByRole: 'owner', acceptedByEmail: 'mw@example.com', companyName: 'Legacy GmbH',
      companyLegalForm: 'GmbH', companyAddress: 'Musterstraße 1, 50667 Köln', userAgent: 'vitest-agent',
    });
    expect(state.orgs[0].address).toBe('Musterstraße 1, 50667 Köln');
    expect(state.audits).toContain('avv.accepted');
    expect(res.body.avv).toMatchObject({ version: '1.1', acceptedByName: 'Matthias W', acceptedByRole: 'owner' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('records an admin as the accepting role', async () => {
    const spy = vi.spyOn(emailService, 'sendAvvSignedEmail').mockResolvedValue({});
    await acceptAvv(req(BODY, { ...OWNER, id: 'user-2', role: 'admin' }), fakeRes());
    expect(state.avvAcceptances[0].acceptedByRole).toBe('admin');
    spy.mockRestore();
  });

  it('refuses a second acceptance while one is on file', async () => {
    const spy = vi.spyOn(emailService, 'sendAvvSignedEmail').mockResolvedValue({});
    await acceptAvv(req(BODY), fakeRes());
    await expect(acceptAvv(req(BODY), fakeRes())).rejects.toMatchObject({ status: 409 });
    expect(state.avvAcceptances).toHaveLength(1);
    spy.mockRestore();
  });

  it('still records the acceptance when the signed-copy email fails', async () => {
    const spy = vi.spyOn(emailService, 'sendAvvSignedEmail').mockRejectedValue(new Error('resend down'));
    const res = fakeRes();
    await acceptAvv(req(BODY), res);
    expect(res.statusCode).toBe(201);
    expect(state.avvAcceptances).toHaveLength(1);
    spy.mockRestore();
  });

  it('keeps an existing legal form when none is sent', async () => {
    state.orgs[0].legalForm = 'AG';
    const spy = vi.spyOn(emailService, 'sendAvvSignedEmail').mockResolvedValue({});
    await acceptAvv(req({ organizationAddress: 'Hauptstraße 2, 10115 Berlin', avvAccepted: true }), fakeRes());
    expect(state.avvAcceptances[0].companyLegalForm).toBe('AG');
    spy.mockRestore();
  });
});

describe('AVV versions', () => {
  const fs = require('fs');
  const { AVV_VERSIONS, CURRENT_AVV_VERSION, avvPdfPath } = require('../services/avv/avvService');

  it('new acceptances use the current version, and its PDF exists', () => {
    expect(CURRENT_AVV_VERSION).toBe('1.1');
    expect(fs.existsSync(avvPdfPath(CURRENT_AVV_VERSION))).toBe(true);
  });

  it('every earlier version stays available (AVV § 18a), so past acceptances keep their own text', () => {
    expect(Object.keys(AVV_VERSIONS)).toEqual(expect.arrayContaining(['1.0', '1.1']));
    for (const version of Object.keys(AVV_VERSIONS)) {
      expect(fs.statSync(avvPdfPath(version)).size).toBeGreaterThan(100000);
    }
  });
});
