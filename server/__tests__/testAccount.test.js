const { installFakeDb } = require('./helpers/fakeDb');

// Test accounts: evaluation without an AVV. The rules that keep "no contract"
// defensible are worth pinning down: the tester's confirmation is required and
// recorded, no AVV record exists, features are blocked, and only an explicit AVV
// acceptance ends the test status.
const state = {};

function makeTx() {
  return {
    organization: {
      create: async ({ data }) => {
        const org = { id: `org-${state.orgs.length + 1}`, accountType: 'production', ...data };
        state.orgs.push(org);
        return org;
      },
      update: async ({ where, data }) => {
        const org = state.orgs.find((o) => o.id === where.id);
        Object.assign(org, data);
        return { ...org };
      },
    },
    user: {
      create: async ({ data }) => {
        const user = { id: `user-${state.users.length + 1}`, ...data };
        state.users.push(user);
        return user;
      },
    },
    avvAcceptance: {
      create: async ({ data }) => {
        const rec = { id: `avv-${state.avvAcceptances.length + 1}`, acceptedAt: new Date(), ...data };
        state.avvAcceptances.push(rec);
        return rec;
      },
    },
  };
}

installFakeDb({
  user: { findUnique: async ({ where }) => state.users.find((u) => u.email === where.email) || null },
  $transaction: async (cb) => cb(makeTx()),
  emailToken: { create: async ({ data }) => ({ id: 'token-1', ...data }) },
  auditLog: { create: async (args) => { state.audits.push(args.data); return {}; } },
  avvAcceptance: {
    findFirst: async ({ where }) => state.avvAcceptances.find((a) => a.organizationId === where.organizationId) || null,
  },
  organization: {
    findUnique: async ({ where }) => state.orgs.find((o) => o.id === where.id) || null,
  },
});

const { registerSchema } = require('../validators/authValidator');
const { register } = require('../controllers/identity/authController');
const { acceptAvv } = require('../controllers/identity/organizationController');
const { requireProductionAccount } = require('../middlewares/authHandler');
const emailService = require('../services/email/emailService');

beforeEach(() => {
  state.orgs = [];
  state.users = [];
  state.avvAcceptances = [];
  state.audits = [];
});

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const TEST_BODY = {
  fullName: 'Dana Protection', email: 'dana@example.com', password: 'correct-horse-battery',
  organizationName: 'Tryout GmbH', accountType: 'test', noRealDataConfirmed: true, lang: 'de',
};
const PROD_BODY = {
  fullName: 'Jane Doe', email: 'jane@example.com', password: 'correct-horse-battery',
  organizationName: 'Acme GmbH', organizationAddress: 'Musterstraße 1, 10115 Berlin', avvAccepted: true,
};

describe('sign-up rules', () => {
  const errorPaths = (body) => {
    const r = registerSchema.safeParse(body);
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  };

  it('a test account needs the no-real-data confirmation, not an address or the AVV', () => {
    expect(errorPaths(TEST_BODY)).toEqual([]);
    expect(errorPaths({ ...TEST_BODY, noRealDataConfirmed: false })).toEqual(['noRealDataConfirmed']);
    expect(errorPaths({ ...TEST_BODY, noRealDataConfirmed: undefined })).toEqual(['noRealDataConfirmed']);
  });

  it('without a choice it is a production account, which still requires address and AVV', () => {
    const parsed = registerSchema.safeParse(PROD_BODY);
    expect(parsed.success).toBe(true);
    expect(parsed.data.accountType).toBe('production');
    expect(errorPaths({ ...PROD_BODY, avvAccepted: false })).toEqual(['avvAccepted']);
    expect(errorPaths({ ...PROD_BODY, avvAccepted: undefined })).toEqual(['avvAccepted']);
    expect(errorPaths({ ...PROD_BODY, organizationAddress: undefined })).toEqual(['organizationAddress']);
  });

  it('rejects unknown account types', () => {
    expect(errorPaths({ ...PROD_BODY, accountType: 'free' })).toEqual(['accountType']);
  });
});

describe('registering a test account', () => {
  const req = (body) => ({ body, headers: { 'user-agent': 'vitest' }, ip: '203.0.113.5' });

  it('records the confirmation, creates no AVV record and no address, and sets no end date', async () => {
    const spy = vi.spyOn(emailService, 'sendAvvSignedEmail').mockResolvedValue({});
    const res = fakeRes();
    const before = Date.now();
    await register(req(TEST_BODY), res);

    expect(res.statusCode).toBe(201); // sample data failing here (no fake models) must not fail sign-up
    expect(state.avvAcceptances).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
    const org = state.orgs[0];
    expect(org.accountType).toBe('test');
    expect(org.address).toBeUndefined();
    expect(org.testConfirmedByEmail).toBe('dana@example.com');
    expect(org.testConfirmedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(org.testExpiresAt).toBeUndefined();
    const started = state.audits.find((a) => a.action === 'org.test_account_started');
    expect(started).toBeTruthy();
    expect(state.audits.some((a) => a.action === 'avv.accepted')).toBe(false);
    spy.mockRestore();
  });

  it('is refused without the confirmation, even past validation', async () => {
    await expect(register(req({ ...TEST_BODY, noRealDataConfirmed: false }), fakeRes())).rejects.toMatchObject({ status: 422 });
    expect(state.orgs).toHaveLength(0);
  });

  it('a production sign-up is unchanged: AVV record, no test fields', async () => {
    const spy = vi.spyOn(emailService, 'sendAvvSignedEmail').mockResolvedValue({});
    await register(req(PROD_BODY), fakeRes());
    expect(state.avvAcceptances).toHaveLength(1);
    expect(state.orgs[0].accountType).toBe('production');
    expect(state.orgs[0].testConfirmedAt).toBeUndefined();
    expect(state.audits.some((a) => a.action === 'avv.accepted')).toBe(true);
    spy.mockRestore();
  });
});

describe('features blocked in a test account', () => {
  const run = (organizationId) => new Promise((resolve) => {
    requireProductionAccount({ organizationId }, {}, (err) => resolve(err));
  });

  it('blocks a test organisation and lets a production one through', async () => {
    state.orgs = [{ id: 'org-t', accountType: 'test' }, { id: 'org-p', accountType: 'production' }];
    expect((await run('org-t')).status).toBe(403);
    expect(await run('org-p')).toBeUndefined();
  });
});

describe('switching to production', () => {
  it('accepting the AVV ends the test status and keeps the earlier confirmation on record', async () => {
    const spy = vi.spyOn(emailService, 'sendAvvSignedEmail').mockResolvedValue({});
    const confirmedAt = new Date('2026-11-02T10:00:00.000Z');
    state.orgs = [{
      id: 'org-1', name: 'Tryout GmbH', accountType: 'test', testConfirmedAt: confirmedAt, testConfirmedByEmail: 'dana@example.com',
    }];
    const user = { id: 'user-1', fullName: 'Dana', email: 'dana@example.com', role: 'owner', organizationId: 'org-1' };
    const res = fakeRes();
    await acceptAvv({
      body: { organizationAddress: 'Hauptstraße 2, 10115 Berlin', avvAccepted: true },
      user, organizationId: 'org-1', headers: {}, ip: '203.0.113.5',
    }, res);

    expect(res.statusCode).toBe(201);
    expect(state.avvAcceptances).toHaveLength(1);
    expect(state.orgs[0]).toMatchObject({ accountType: 'production', testConfirmedAt: confirmedAt });
    spy.mockRestore();
  });
});
