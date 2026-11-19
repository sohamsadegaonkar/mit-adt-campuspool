#!/usr/bin/env node
'use strict';

// PR_BASE_SHA / PR_HEAD_SHA identify the PR comparison; pushes validate baseline docs.
// This checks completeness and conservative path classification, not factual accuracy.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const requiredDocs = {
  'AGENTS.md': ['## Non-negotiable documentation rule', '## Minimum complexity engineering protocol (mandatory)', '## Agent quick-start checklist'],
  'docs/agents/MINIMUM_COMPLEXITY.md': ['## Objective', '## Review levels', '## Record format', '## Enforcement and limits'],
  'docs/agents/README.md': ['## Order for a new agent'],
  'docs/agents/STATUS.md': ['## State matrix', '## Security and release blockers'],
  'docs/agents/NEXT_STEPS.md': ['## Sequencing rules', '## For the next agent'],
  'docs/agents/ARCHITECTURE_MAP.md': ['## Runtime shape', '## Data boundaries'],
  'docs/agents/DECISIONS.md': ['## Decision rule for adding infrastructure'],
  'docs/agents/tasks/TEMPLATE.md': ['## Goal and acceptance criteria', '## Current state', '## Plan', '## Minimum complexity review', '## Progress log', '## Verification', '## Next steps'],
};
const taskSections = ['## Goal and acceptance criteria', '## Current state', '## Plan', '## Progress log', '## Verification', '## Next steps'];
const failures = [];
const log = message => process.stdout.write(message + '\n');

function validateSections(path, sections) {
  if (!fs.existsSync(path)) { failures.push('Missing required document: ' + path); return; }
  const body = fs.readFileSync(path, 'utf8');
  for (const section of sections) {
    if (!body.includes(section)) failures.push('Missing section in ' + path + ': ' + section);
  }
  if (!body.trim()) failures.push('Empty document: ' + path);
}
// Significant classification is deliberately conservative, not exhaustive.
function requiresSignificant(path) {
  return /(^|\/)(package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|pubspec(?:\.lock|\.yaml)|(?:requirements[^/]*\.txt|pyproject\.toml)|Dockerfile(?:\.[^/]*)?|render\.yaml|docker-compose[^/]*\.ya?ml)$/i.test(path) ||
    /(^|\/)(migrations|infra|ops)\//.test(path) ||
    /^\.github\/workflows\//.test(path) || path === 'scripts/check-agent-docs.js';
}
const reviewHeading = '## Minimum complexity review';
const smallFields = ['Existing / smallest', 'Decision', 'Validation'];
const significantFields = ['Conventional alternative', 'First-principles alternative', 'Tradeoffs', 'Evidence'];
function reviewErrors(body, forceSignificant) {
  const headings = body.split(/\r?\n/);
  const start = headings.indexOf(reviewHeading);
  if (start < 0) return ['Missing ' + reviewHeading];
  if (headings.lastIndexOf(reviewHeading) !== start) return ['Duplicate ' + reviewHeading];
  const lines = [];
  for (const line of headings.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    lines.push(line);
  }
  function value(label) {
    const prefix = '- **' + label + ':**';
    const matches = lines.filter(line => line.startsWith(prefix));
    return matches.length === 1 ? matches[0].slice(prefix.length).trim() : '';
  }
  const level = value('Level');
  const errors = [];
  if (!['small','significant'].includes(level)) errors.push('Level must be small or significant');
  if (forceSignificant && level !== 'significant') errors.push('Changed path requires significant review');
  const fields = [...smallFields, ...(level === 'significant' || forceSignificant ? significantFields : [])];
  for (const field of fields) {
    const v = value(field);
    if (!v || /^(?:n\/?a|none|todo|tbd|pending|placeholder|\.\.\.|[-–—]+|<[^>]+>)\.?$/i.test(v)) {
      errors.push('Missing, duplicate or placeholder field: ' + field);
    }
  }
  return errors;
}
for (const [path, sections] of Object.entries(requiredDocs)) validateSections(path, sections);

const base = process.env.PR_BASE_SHA;
const head = process.env.PR_HEAD_SHA;
if (!!base !== !!head) failures.push('PR_BASE_SHA and PR_HEAD_SHA must be provided together');
if (base && head) {
  let paths = [];
  try {
    paths = execFileSync('git', ['diff', '--name-only', '--no-renames', '--diff-filter=ACDMRT', '-z', base + '...' + head],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\0').filter(Boolean);
  } catch (error) {
    failures.push('Could not compare PR commits. Use checkout fetch-depth: 0. ' + error.message.split('\n')[0]);
  }
  const isImplementation = path =>
    !path.startsWith('docs/agents/') && !/\.(md|mdx)$/i.test(path);
  const codePaths = paths.filter(isImplementation);
  log('PR paths changed: ' + paths.length + '; implementation/config paths: ' + codePaths.length);
  if (codePaths.length) {
    for (const path of ['docs/agents/STATUS.md', 'docs/agents/NEXT_STEPS.md']) {
      if (!paths.includes(path)) failures.push('Implementation PR must update ' + path);
    }
    const taskPaths = paths.filter(path =>
      /^docs\/agents\/tasks\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(path) &&
      fs.existsSync(path));
    if (!taskPaths.length) failures.push(
      'Implementation PR must add/update a unique docs/agents/tasks/YYYY-MM-DD-topic.md handoff');
    const forceSignificant = codePaths.some(requiresSignificant);
    const reviews = [];
    for (const path of taskPaths) {
      validateSections(path, taskSections);
      reviews.push({ path, errors: reviewErrors(fs.readFileSync(path, 'utf8'), forceSignificant) });
    }
    // One complete task is sufficient for a scoped PR, including when it
    // also updates older handoffs. Reviewers ensure it covers the whole diff.
    if (reviews.length && !reviews.some(record => !record.errors.length)) {
      for (const {path, errors} of reviews) {
        for (const error of errors) failures.push(path + ': ' + error);
      }
    }
  }
}
if (failures.length) {
  process.stderr.write('Agent documentation contract FAILED:\n' +
    failures.map(x => '- ' + x).join('\n') + '\n');
  process.exitCode = 1;
} else {
  log('Agent documentation contract passed. Human review must still verify claims.');
}
