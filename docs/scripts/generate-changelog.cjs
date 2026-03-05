#!/usr/bin/env node
/**
 * Merge GitHub Releases into docs/changelog.md.
 *
 * Reads the existing hand-written changelog, fetches published releases
 * from GitHub, and merges them — preserving any manually written entries
 * and only adding releases that aren't already documented.
 *
 * Priority: hand-written entries always win. GitHub releases fill gaps.
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

/**
 * Extract version numbers already present in the existing changelog.
 * Matches headings like "## v2.3.0", "## v2.2.1 <Badge ...>", etc.
 * Returns a Set of normalized version strings (e.g. "2.3.0", "2.2.1").
 */
function extractExistingVersions(content) {
  const versions = new Set();
  const re = /^## v?([\d.]+)/gm;
  let match;
  while ((match = re.exec(content)) !== null) {
    versions.add(match[1]);
  }
  return versions;
}

/**
 * Normalize a release tag/name to a plain version string.
 * "v2.3.0" → "2.3.0", "2.3.0" → "2.3.0"
 */
function normalizeVersion(tag) {
  return tag.replace(/^v/, '');
}

function formatRelease(release) {
  const tag = release.tag_name || release.name;
  const title = release.name || tag;
  const date = release.published_at
    ? new Date(release.published_at).toISOString().split('T')[0]
    : '';
  const body = (release.body || '').trim();

  // Build the section header
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
  // Read existing changelog
  let existing = '';
  if (fs.existsSync(OUTPUT)) {
    existing = fs.readFileSync(OUTPUT, 'utf-8');
  }

  const existingVersions = extractExistingVersions(existing);
  console.log(`Existing changelog has ${existingVersions.size} version(s): ${[...existingVersions].join(', ') || '(none)'}`);

  // Fetch GitHub releases
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

  // Find releases not already in the hand-written changelog
  const newReleases = published.filter(r => {
    const tag = r.tag_name || r.name;
    const version = normalizeVersion(tag);
    return !existingVersions.has(version);
  });

  if (newReleases.length === 0) {
    console.log(`All ${published.length} release(s) already documented. No changes needed.`);
    // Still ensure frontmatter is present
    if (!existing.startsWith('---')) {
      const content = [
        '---',
        'outline: [2, 3]',
        '---',
        '',
        existing,
      ].join('\n');
      fs.writeFileSync(OUTPUT, content, 'utf-8');
      console.log('Added frontmatter to existing changelog.');
    }
    return;
  }

  console.log(`Found ${newReleases.length} new release(s) to add: ${newReleases.map(r => r.tag_name).join(', ')}`);

  // Build new release sections
  const newSections = newReleases.map(formatRelease);

  // Strip frontmatter and header from existing content for merging
  let body = existing;
  // Remove YAML frontmatter
  body = body.replace(/^---[\s\S]*?---\s*/, '');
  // Remove the "# Changelog" heading
  body = body.replace(/^#\s+Changelog\s*\n*/, '');
  body = body.trim();

  // Merge: new GitHub releases at the top, then existing hand-written content
  const content = [
    '---',
    'outline: [2, 3]',
    '---',
    '',
    '# Changelog',
    '',
    ...newSections,
    body ? body + '\n' : '',
  ].join('\n');

  fs.writeFileSync(OUTPUT, content, 'utf-8');
  console.log(`Wrote ${OUTPUT} — added ${newReleases.length} release(s), preserved ${existingVersions.size} existing entries.`);
}

main().catch(err => {
  console.error('Changelog generation failed:', err.message);
  console.log('Keeping existing changelog.md as-is.');
  process.exit(0); // Don't fail the build
});
