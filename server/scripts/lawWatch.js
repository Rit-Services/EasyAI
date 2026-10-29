/* Monthly law watch (runs as the jurisai-law-watch CronJob on cluster 2).
   Asks the Claude proxy whether each law in the catalog is still current and
   whether new AI-relevant laws or bills have appeared, has every proposed
   change checked a second time, applies the confirmed ones to content/*.json
   and publishes them as one commit on the deploy branch, which deploys them.
   Emails a summary of what changed, what was rejected and what it cost.

   node scripts/lawWatch.js                    read + publish via GitHub (cron)
   node scripts/lawWatch.js --local ../content  read + write a local content dir
   add --dry-run to change nothing, --only k1,k2 to check just those laws,
   --no-discovery to skip the search for new laws.

   Env: CLAUDE_PROXY_TOKEN (required), LAW_WATCH_GITHUB_TOKEN, LAW_WATCH_REPO,
   LAW_WATCH_BRANCH, LAW_WATCH_NOTIFY_EMAIL, LAW_WATCH_MODEL, LAW_WATCH_EFFORT,
   LAW_WATCH_CONCURRENCY. */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { askJson } = require('../services/lawWatch/claudeProxy');
const github = require('../services/lawWatch/githubRepo');
const lw = require('../services/lawWatch/lawWatch');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

const env = {
  token: process.env.CLAUDE_PROXY_TOKEN,
  ghToken: process.env.LAW_WATCH_GITHUB_TOKEN,
  repo: process.env.LAW_WATCH_REPO || 'Rit-Services/EasyAI',
  branch: process.env.LAW_WATCH_BRANCH || 'k8s-deployment',
  notify: process.env.LAW_WATCH_NOTIFY_EMAIL ?? 'compliance@rit.services',
  model: process.env.LAW_WATCH_MODEL || 'claude-opus-5-5',
  effort: process.env.LAW_WATCH_EFFORT || 'medium',
  concurrency: Math.max(1, parseInt(process.env.LAW_WATCH_CONCURRENCY || '3', 10)),
};

// Run `fn` over `items` with at most `n` in flight (the proxy is shared).
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// Filled in as the run goes, so a run that stops still reports what it did.
const report = {
  today: new Date().toISOString().slice(0, 10),
  checked: [], updated: [], newLaws: [], news: [], rejected: [], errors: [], expired: [], costUsd: 0,
};

async function main() {
  if (!env.token) throw new Error('CLAUDE_PROXY_TOKEN is not set');
  const local = option('--local');
  const dryRun = flag('--dry-run');
  const only = option('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const { today } = report;

  // 1. Current content: the branch head on GitHub, or a local folder.
  let repo; let headSha;
  const before = {};
  if (local) {
    for (const p of Object.values(lw.FILES)) before[p] = fs.readFileSync(path.join(local, path.basename(p)), 'utf8');
  } else {
    if (!env.ghToken) throw new Error('LAW_WATCH_GITHUB_TOKEN is not set');
    repo = github.client({ token: env.ghToken, repo: env.repo, branch: env.branch });
    headSha = await repo.headSha();
    for (const p of Object.values(lw.FILES)) before[p] = await repo.readFile(p, headSha);
  }
  const content = lw.parseContent(before);
  report.expired = lw.expireFeatured(content, today);

  const ask = async (prompt) => {
    const { json, costUsd } = await askJson({ ...prompt, model: env.model, effort: env.effort, token: env.token });
    report.costUsd += costUsd;
    return json;
  };
  const verified = async (subject, proposal) => {
    const v = await ask(lw.verifyPrompt(subject, proposal, today));
    return v.approved === true ? null : (v.problems || ['not approved']).join('; ');
  };

  // 2. Check every law (or the --only ones).
  const keys = content.frameworks.map((f) => f.key).filter((k) => !only || only.includes(k));
  const proposals = [];
  await pool(keys, env.concurrency, async (key) => {
    try {
      const answer = await ask(lw.checkPrompt(content, key, today));
      report.checked.push(key);
      const p = lw.validateLawCheck(answer, content, key, today);
      if (!p) { logger.info(`law watch: ${key} unchanged`); return; }
      const problem = await verified(content.frameworks.find((f) => f.key === key).name, p);
      if (problem) { report.rejected.push({ key, summary: p.summary, reason: `second check: ${problem}` }); return; }
      proposals.push(p);
      logger.info(`law watch: ${key} change confirmed: ${p.summary}`);
      if (flag('--dry-run')) logger.info(`law watch: ${key} proposal ${JSON.stringify(p, null, 2)}`);
    } catch (err) {
      const bucket = err instanceof lw.Invalid ? report.rejected : report.errors;
      bucket.push({ key, reason: err.message });
      logger.warn(`law watch: ${key}: ${err.message}`);
    }
  });

  // 3. New laws and bills.
  const newLaws = [];
  if (!only && !flag('--no-discovery')) {
    try {
      const found = (await ask(lw.discoveryPrompt(content, today))).laws || [];
      for (const raw of found.slice(0, lw.LIMITS.newLaws)) {
        try {
          const law = lw.validateNewLaw(raw, content, today);
          const problem = await verified(law.name, law);
          if (problem) report.rejected.push({ key: law.key, summary: `new law ${law.name}`, reason: `second check: ${problem}` });
          else newLaws.push(law);
        } catch (err) {
          report.rejected.push({ key: raw?.key || '?', summary: `new law ${raw?.name || ''}`, reason: err.message });
        }
      }
    } catch (err) {
      report.errors.push({ key: 'discovery', reason: err.message });
    }
  }

  // 4. Apply, check and publish.
  if (proposals.length > lw.LIMITS.updates) {
    throw new Error(`${proposals.length} law changes in one run is more than the limit of ${lw.LIMITS.updates}; nothing was published`);
  }
  for (const key of report.checked) content.frameworks.find((f) => f.key === key).lastReviewedAt = today;
  for (const p of proposals) {
    const item = lw.applyLawUpdate(content, p, today);
    report.updated.push({ key: p.key, summary: p.summary, fields: Object.keys(p.update), timeline: !!p.timeline, sources: p.sources, ignored: p.ignored });
    if (item) report.news.push(item);
  }
  for (const law of newLaws) {
    const item = lw.applyNewLaw(content, law, today);
    report.newLaws.push({ key: law.key, name: law.name, status: law.status, sources: law.sources });
    if (item) report.news.push(item);
  }
  const problems = lw.checkCatalog(content);
  if (problems.length) throw new Error(`catalog check failed, nothing was published: ${problems.join('; ')}`);

  const files = lw.changedFiles(before, content);
  report.files = Object.keys(files);
  if (dryRun) {
    logger.info('law watch: dry run, nothing written');
  } else if (local) {
    for (const [p, text] of Object.entries(files)) fs.writeFileSync(path.join(local, path.basename(p)), text);
  } else if (report.files.length) {
    report.commit = await repo.commitFiles({ parentSha: headSha, files, message: commitMessage(report) });
    logger.info(`law watch: published commit ${report.commit}`);
  }
}

function commitMessage(r) {
  const lines = [`content: monthly law check ${r.today} (${r.updated.length} updated, ${r.newLaws.length} new, ${r.news.length} news)`, ''];
  for (const u of r.updated) lines.push(`- ${u.key}: ${u.summary}`);
  for (const n of r.newLaws) lines.push(`- new: ${n.key} (${n.status}): ${n.name}`);
  if (r.expired.length) lines.push(`- homepage banner ended: ${r.expired.join(', ')}`);
  lines.push('', `Checked ${r.checked.length} laws with the Claude proxy; every change confirmed by a second check.`);
  return lines.join('\n');
}

async function notify(fatal) {
  if (!env.notify || flag('--dry-run') || option('--local')) return;
  const emailService = require('../services/email/emailService');
  const esc = emailService.escapeHtml;
  const src = (s) => s.map((x) => `<a href="${esc(x.url)}">${esc(x.label)}</a>`).join(', ');
  const rows = [];
  if (fatal) rows.push(`<p style="color:#b42318;"><strong>The run stopped:</strong> ${esc(fatal)}</p>`);
  if (report.updated.length) rows.push(`<h3>Updated</h3><ul>${report.updated.map((u) => `<li><strong>${esc(u.key)}</strong>: ${esc(u.summary)}<br><small>${src(u.sources)}</small></li>`).join('')}</ul>`);
  if (report.newLaws.length) rows.push(`<h3>New laws added</h3><ul>${report.newLaws.map((n) => `<li><strong>${esc(n.name)}</strong> (${n.status === 'draft' ? 'watch list' : 'in force'})<br><small>${src(n.sources)}</small></li>`).join('')}</ul>`);
  if (report.news.length) rows.push(`<h3>News published</h3><ul>${report.news.map((n) => `<li>${esc(n.title.en)}</li>`).join('')}</ul>`);
  if (report.rejected.length) rows.push(`<h3>Not applied</h3><ul>${report.rejected.map((x) => `<li><strong>${esc(x.key)}</strong>: ${esc(x.summary || '')} ${esc(x.reason)}</li>`).join('')}</ul>`);
  if (report.errors.length) rows.push(`<h3>Errors</h3><ul>${report.errors.map((x) => `<li>${esc(x.key)}: ${esc(x.reason)}</li>`).join('')}</ul>`);
  const status = fatal ? 'stopped' : report.commit ? `published (commit ${report.commit.slice(0, 7)})` : 'no changes';
  rows.push(`<p style="color:#5b6373;font-size:13px;">Checked ${report.checked.length} laws · ${status} · cost $${report.costUsd.toFixed(2)}</p>`);
  const subject = fatal
    ? `Law watch ${report.today}: stopped, nothing published`
    : `Law watch ${report.today}: ${report.updated.length} updated, ${report.newLaws.length} new, ${report.rejected.length} not applied`;
  await emailService.sendMail({
    to: env.notify,
    subject,
    text: `${subject}\n\n${rows.join('\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ')}`,
    html: emailService.emailShell('Monthly law watch', rows.join('\n')),
  });
}

main()
  .then(async () => {
    logger.info(`law watch done: ${JSON.stringify({ ...report, updated: report.updated.map((u) => u.key), news: report.news.map((n) => n.id) })}`);
    await notify().catch((err) => logger.warn('law watch: summary email failed', err.message));
  })
  .catch(async (err) => {
    logger.error('law watch failed', err.message);
    await notify(err.message).catch((e) => logger.warn('law watch: alert email failed', e.message));
    process.exitCode = 1;
  });
