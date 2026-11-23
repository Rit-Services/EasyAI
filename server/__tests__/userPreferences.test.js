const { installFakeDb } = require('./helpers/fakeDb');

// Language and theme are saved on the account, in the database, so they follow
// the person to any browser or device. Same fake-Prisma approach as authRegister.
const state = {};

installFakeDb({
  user: {
    update: async ({ where, data }) => {
      const user = state.users.find((u) => u.id === where.id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) user[key] = value; // Prisma ignores undefined
      }
      return { ...user };
    },
  },
});

const { updatePreferencesSchema } = require('../validators/userValidator');
const { updatePreferences } = require('../controllers/identity/userController');
const { publicUser } = require('../controllers/identity/authController');

function fakeRes() {
  return {
    body: null,
    json(payload) { this.body = payload; return this; },
  };
}

beforeEach(() => {
  state.users = [
    { id: 'user-1', role: 'owner', language: null, theme: null },
    { id: 'user-2', role: 'owner', language: 'de', theme: 'light' },
  ];
});

const save = async (body, user = state.users[0]) => {
  const res = fakeRes();
  await updatePreferences({ body, user }, res);
  return res.body;
};

describe('preference rules', () => {
  const ok = (body) => updatePreferencesSchema.safeParse(body).success;

  it('accepts either choice or both', () => {
    expect(ok({ language: 'en' })).toBe(true);
    expect(ok({ theme: 'dark' })).toBe(true);
    expect(ok({ language: 'de', theme: 'light' })).toBe(true);
  });

  it('refuses unknown values and an empty update', () => {
    expect(ok({ language: 'fr' })).toBe(false);
    expect(ok({ theme: 'blue' })).toBe(false);
    expect(ok({ language: null })).toBe(false);
    expect(ok({})).toBe(false);
  });

  it('keeps only the two preferences, so nothing else can be changed this way', () => {
    const parsed = updatePreferencesSchema.parse({ language: 'en', role: 'platform_admin', email: 'x@example.com' });
    expect(parsed).toEqual({ language: 'en' });
  });
});

describe('saving preferences', () => {
  it('saves a choice and returns both values', async () => {
    const body = await save({ language: 'en' });
    expect(body).toEqual({ preferences: { language: 'en', theme: null } });
    expect(state.users[0].language).toBe('en');
  });

  it('leaves the other choice alone', async () => {
    await save({ language: 'en' });
    await save({ theme: 'dark' });
    expect(state.users[0]).toMatchObject({ language: 'en', theme: 'dark' });
  });

  it('only ever changes the signed-in person', async () => {
    await save({ language: 'en', theme: 'dark' });
    expect(state.users[1]).toMatchObject({ language: 'de', theme: 'light' });
  });
});

describe('the session sent to the client', () => {
  it('carries the saved choices, and null until they are made', () => {
    expect(publicUser(state.users[0])).toMatchObject({ language: null, theme: null });
    expect(publicUser(state.users[1])).toMatchObject({ language: 'de', theme: 'light' });
  });
});
