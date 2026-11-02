const { z } = require('zod');

const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  legalForm: z.string().trim().max(80).nullish(),
  address: z.string().trim().max(300).nullish(),
  industry: z.string().trim().max(120).nullish(),
  country: z.string().trim().max(2).optional(),
  sizeBand: z.string().trim().max(40).nullish(),
  // AVV Section 16.2: whether RIT's non-EU support team (Anlage 3 Nr. 5) may
  // ever be given pseudonymised access for a support case. Default false.
  allowNonEuSupportAccess: z.boolean().optional(),
});

const updateFunctionsSchema = z.object({
  selectedFunctions: z.array(z.string().max(60)).max(100),
});

// Accepting the AVV after registration (organisations created before the AVV
// was part of sign-up). Same fields and rules as the registration form.
const acceptAvvSchema = z.object({
  organizationAddress: z.string().trim().min(4, 'Address is required to accept the Data Processing Agreement').max(300),
  organizationLegalForm: z.string().trim().max(80).optional(),
  avvAccepted: z.literal(true, { message: 'You must accept the Data Processing Agreement (AVV) to continue' }),
});

module.exports = { updateOrganizationSchema, updateFunctionsSchema, acceptAvvSchema };
