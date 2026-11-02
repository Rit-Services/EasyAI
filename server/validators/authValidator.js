const { z } = require('zod');

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  organizationName: z.string().trim().min(2).max(160).optional(),
  organizationLegalForm: z.string().trim().max(80).optional(),
  // "production" concludes the AVV at sign-up. "test" is an evaluation account
  // with no contract: a data protection officer may not sign one just to try the
  // product, so no real personal data may be entered and no AVV is created.
  accountType: z.enum(['production', 'test']).default('production'),
  organizationAddress: z.string().trim().max(300).optional(),
  avvAccepted: z.boolean().optional(),
  noRealDataConfirmed: z.boolean().optional(),
  // Language of the example AI systems a test account starts with.
  lang: z.enum(['en', 'de']).optional(),
}).superRefine((v, ctx) => {
  if (v.accountType === 'test') {
    if (v.noRealDataConfirmed !== true) {
      ctx.addIssue({ code: 'custom', path: ['noRealDataConfirmed'], message: 'Please confirm that no real personal data may be entered in a test account' });
    }
    return;
  }
  // Production: the Art. 28 AVV (Section 18, "Abschluss der Vereinbarung" table)
  // captures the customer's address as part of the mandatory registration-time
  // acceptance, not as an optional profile field filled in later.
  if (!v.organizationAddress || v.organizationAddress.length < 4) {
    ctx.addIssue({ code: 'custom', path: ['organizationAddress'], message: 'Address is required to accept the Data Processing Agreement' });
  }
  // "Not accepted" is a validation error, not a silently-ignored field, matching
  // the AVV's own "zwingender Abschluss" (Section 5.1).
  if (v.avvAccepted !== true) {
    ctx.addIssue({ code: 'custom', path: ['avvAccepted'], message: 'You must accept the Data Processing Agreement (AVV) to create an account' });
  }
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

const emailOnlySchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
});

const verifySchema = z.object({
  token: z.string().min(10, 'Verification token is required'),
});

const resetSchema = z.object({
  token: z.string().min(10, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

// MFA: a code is a 6-digit TOTP or a backup code like "a1b2-c3d4".
const mfaCodeSchema = z.object({
  code: z.string().trim().min(4, 'Enter the code from your authenticator app').max(20),
});
const mfaDisableSchema = z.object({
  password: z.string().min(1, 'Your password is required'),
});
const mfaVerifySchema = z.object({
  mfaToken: z.string().min(10, 'Verification session is required'),
  code: z.string().trim().min(4, 'Enter your code').max(20),
});

module.exports = {
  registerSchema, loginSchema, emailOnlySchema, verifySchema, resetSchema,
  mfaCodeSchema, mfaDisableSchema, mfaVerifySchema,
};
