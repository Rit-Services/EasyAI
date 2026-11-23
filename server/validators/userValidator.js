const { z } = require('zod');

const updateMeSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
});

const updateRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

const updatePreferencesSchema = z.object({
  language: z.enum(['en', 'de']).optional(),
  theme: z.enum(['light', 'dark']).optional(),
}).refine((v) => v.language || v.theme, { message: 'Nothing to update' });

module.exports = { updateMeSchema, updateRoleSchema, updatePreferencesSchema };
