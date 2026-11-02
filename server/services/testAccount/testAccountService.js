// Test accounts: evaluation without an AVV. A data protection officer may not
// conclude a contract just to try the product, so a test organisation has none.
// That only holds if no personal data is processed on the customer's behalf, so
// the tester confirms at sign-up that none may be entered (recorded on the
// organisation), a permanent banner repeats it, and the features that would bring
// it in (uploads, invitations, community posting) are blocked
// (requireProductionAccount). Accepting the AVV in Settings switches to production.
const { prisma } = require('../../db/db');
const classificationService = require('../classification/classificationService');
const { encryptField, encryptJson } = require('../crypto/fieldCrypto');

const QUESTIONNAIRE = 'eu_ai_act_risk';

// Fictional AI systems, one per typical risk outcome, so a tester can see the
// product working without typing anything real.
const SAMPLES = [
  {
    name: { en: 'Example: Customer support chatbot', de: 'Beispiel: Kundenservice-Chatbot' },
    purpose: { en: 'Answers common customer questions on the website (fictional example).', de: 'Beantwortet häufige Kundenfragen auf der Website (fiktives Beispiel).' },
    vendor: 'third_party',
    lifecycleStage: 'deployed',
    answers: { interacts_with_people: true, generates_content: true },
  },
  {
    name: { en: 'Example: CV screening tool', de: 'Beispiel: Vorauswahl von Bewerbungen' },
    purpose: { en: 'Ranks incoming job applications for the HR team (fictional example).', de: 'Sortiert eingehende Bewerbungen für die Personalabteilung vor (fiktives Beispiel).' },
    vendor: 'third_party',
    lifecycleStage: 'planning',
    answers: { recruitment_employment: true },
  },
  {
    name: { en: 'Example: Spam filter', de: 'Beispiel: Spamfilter' },
    purpose: { en: 'Sorts unwanted emails out of the shared inbox (fictional example).', de: 'Sortiert unerwünschte E-Mails aus dem Sammelpostfach aus (fiktives Beispiel).' },
    vendor: 'in_house',
    lifecycleStage: 'deployed',
    answers: {},
  },
];

async function createSampleData({ organizationId, userId, lang = 'en' }) {
  const l = lang === 'de' ? 'de' : 'en';
  for (const sample of SAMPLES) {
    const { riskCategory, explanation } = await classificationService.classify(QUESTIONNAIRE, sample.answers, l);
    const aiSystem = await prisma.aiSystem.create({
      data: {
        organizationId,
        name: sample.name[l],
        purpose: await encryptField(organizationId, sample.purpose[l]),
        vendor: sample.vendor,
        lifecycleStage: sample.lifecycleStage,
        createdById: userId,
        riskCategory,
        classificationExplanation: await encryptField(organizationId, explanation),
        classificationAnswers: await encryptJson(organizationId, sample.answers),
        classificationQuestionnaireKey: QUESTIONNAIRE,
        classifiedAt: new Date(),
      },
    });
    await classificationService.instantiateAssessments({ organizationId, aiSystem });
  }
}

module.exports = { createSampleData, SAMPLES };
