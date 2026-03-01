/**
 * GitHub repository invitation via the GitHub API.
 *
 * After a successful Stripe payment, invite the customer's GitHub account
 * as a collaborator on the private Citadel repo.
 *
 * Configure via environment variables:
 *   GITHUB_TOKEN         — Personal access token with repo:invite scope
 *   GITHUB_REPO_OWNER    — e.g. "Sk3tch-Dev-Ux"
 *   GITHUB_REPO_NAME     — e.g. "DayzServerController"
 */

const GITHUB_API = 'https://api.github.com';

/**
 * Invite a GitHub user as a collaborator on the private repo.
 * @param {string} githubUsername — Customer's GitHub username
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function inviteToRepo(githubUsername) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;

  if (!token || !owner || !repo) {
    console.warn('GitHub invite skipped — GITHUB_TOKEN/GITHUB_REPO_OWNER/GITHUB_REPO_NAME not configured');
    return { success: false, message: 'GitHub integration not configured' };
  }

  if (!githubUsername || typeof githubUsername !== 'string') {
    return { success: false, message: 'No GitHub username provided' };
  }

  const username = githubUsername.trim().replace(/^@/, '');
  if (!username) {
    return { success: false, message: 'Empty GitHub username' };
  }

  try {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/collaborators/${username}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ permission: 'pull' }),
    });

    if (res.status === 201) {
      console.log(`GitHub invite sent to @${username} (pending acceptance)`);
      return { success: true, message: `Invitation sent to @${username}` };
    }

    if (res.status === 204) {
      console.log(`@${username} is already a collaborator`);
      return { success: true, message: `@${username} already has access` };
    }

    const body = await res.json().catch(() => ({}));
    const msg = body.message || `GitHub API returned ${res.status}`;
    console.error(`GitHub invite failed for @${username}: ${msg}`);
    return { success: false, message: msg };
  } catch (err) {
    console.error(`GitHub invite error for @${username}:`, err.message);
    return { success: false, message: err.message };
  }
}

module.exports = { inviteToRepo };
