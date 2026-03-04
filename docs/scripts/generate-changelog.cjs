#!/usr/bin/env node
/**
 * Generate docs/changelog.md from GitHub Releases.
 *
 * Fetches all published releases from the GitHub API, converts them to
 * a single markdown file, and writes it to docs/changelog.md. If no
 * releases exist yet, falls back to the existing changelog (no-op).
 *
 * Usage:
 *   node docs/scripts/generate-changelog.cjs
 *
 * Environment:
 *   GITHUB_TOKEN  — Optional. Raises rate limit from 60→5000 req/hr.
 *   GITHUB_REPO   — Optional. Defaults to Sk3tch-Dev-Ux/DayzServerController.
 */
const fs = require('fs');
const path = require('path');

const REPO = process.env.GITHUB_REPO || 'Sk3tch-Dev-Ux/DayzServerController';
const API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
const OUTPUT = path.join(__dirname, '..', 'changelog.md');

async function fetchReleases() {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Citadel-Docs-Builder',
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(API_URL, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

function formatRelease(release) {
  const tag = release.tag_name || release.name;
  const title = release.name || tag;
  const date = release.published_at
    ? new Date(release.published_at).toISOString().split('T')[0]
    : '';
  const body = (release.body || '').trim();

  // Build the section header
  // If the release name already starts with "v", use it as-is for the heading
  const heading = title.startsWith('v') ? title : `v${title}`;
  let md = `## ${heading}`;
  if (date) md += ` <Badge type="tip" text="${date}" />`;
  md += '\n\n';

  if (body) {
    md += body + '\n';
  } else {
    md += '_No release notes provided._\n';
  }

  return md;
}

async function main() {
  console.log(`Fetching releases from ${REPO}...`);

  let releases;
  try {
    releases = await fetchReleases();
  } catch (err) {
    console.warn(`Could not fetch releases: ${err.message}`);
    console.log('Keeping existing changelog.md as-is.');
    return;
  }

  // Filter to published releases only, sort newest first
  const published = releases
    .filter(r => !r.draft)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  if (published.length === 0) {
    console.log('No published releases found. Keeping existing changelog.md.');
    return;
  }

  console.log(`Found ${published.length} release(s). Generating changelog...`);

  // Build the full markdown
  const sections = published.map(formatRelease);
  const content = [
    '---',
    'outline: [2, 3]',
    '---',
    '',
    '# Changelog',
    '',
    ...sections,
  ].join('\n');

  fs.writeFileSync(OUTPUT, content, 'utf-8');
  console.log(`Wrote ${OUTPUT} (${published.length} releases)`);
}

main().catch(err => {
  console.error('Changelog generation failed:', err.message);
  console.log('Keeping existing changelog.md as-is.');
  process.exit(0); // Don't fail the build
});
