#!/usr/bin/env node
'use strict';

// The workflow uses PR_BASE_SHA and PR_HEAD_SHA on PRs; pushes validate
// baseline documents only. This checks completeness, not factual accuracy.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const requiredDocs = {
  'AGENTS.md': ['## Non-negotiable documentation rule', '## Agent quick-start checklist'],
  'docs/agents/README.md': ['## Order for a new agent'],
  'docs/agents/STATUS.md': ['## State matrix', '## Security and release blockers'],
  'docs/agents/NEXT_STEPS.md': ['## Sequencing rules', '## For the next agent'],
  'docs/agents/ARCHITECTURE_MAP.md': ['## Runtime shape', '## Data boundaries'],
  'docs/agents/DECISIONS.md': ['## Decision rule for adding infrastructure'],
  'docs/agents/tasks/TEMPLATE.md': ['## Goal and acceptance criteria', '## Current state', '## Plan', '## Progress log', '## Verification', '## Next steps'],
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
for (const [path, sections] of Object.entries(requiredDocs)) validateSections(path, sections);

const base = process.env.PR_BASE_SHA;
const head = process.env.PR_HEAD_SHA;
if (!!base !== !!head) failures.push('PR_BASE_SHA and PR_HEAD_SHA must be provided together');
if (base && head) {
  let paths = [];
  try {
    paths = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', '-z', base, head],
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
      /^docs\/agents\/tasks\/[^/]+\.md$/.test(path) &&
      path !== 'docs/agents/tasks/TEMPLATE.md');
    if (!taskPaths.length) failures.push(
      'Implementation PR must add/update a unique docs/agents/tasks/YYYY-MM-DD-topic.md handoff');
    for (const path of taskPaths) validateSections(path, taskSections);
  }
}
if (failures.length) {
  process.stderr.write('Agent documentation contract FAILED:\n' +
    failures.map(x => '- ' + x).join('\n') + '\n');
  process.exitCode = 1;
} else {
  log('Agent documentation contract passed. Human review must still verify claims.');
}
