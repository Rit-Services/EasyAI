// Minimal GitHub REST client for the law watch: read files from a branch and
// publish several changed files as one commit (Git Data API), so the push
// triggers the normal build-and-deploy workflow.
const API = 'https://api.github.com';

function client({ token, repo, branch }) {
  async function call(method, path, body) {
    const res = await fetch(`${API}/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'compliance-check-law-watch',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  return {
    async headSha() {
      const ref = await call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
      return ref.object.sha;
    },

    // Text of `path` at commit `sha` (or the branch head).
    async readFile(path, sha) {
      const ref = encodeURIComponent(sha || branch);
      const file = await call('GET', `/contents/${path}?ref=${ref}`);
      return Buffer.from(file.content, file.encoding || 'base64').toString('utf8');
    },

    // One commit on top of `parentSha` with the given { path: text } files.
    // Fails (no force) if the branch moved since parentSha was read.
    async commitFiles({ parentSha, files, message }) {
      const parent = await call('GET', `/git/commits/${parentSha}`);
      const tree = [];
      for (const [path, content] of Object.entries(files)) {
        const blob = await call('POST', '/git/blobs', { content, encoding: 'utf-8' });
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const newTree = await call('POST', '/git/trees', { base_tree: parent.tree.sha, tree });
      const commit = await call('POST', '/git/commits', { message, tree: newTree.sha, parents: [parentSha] });
      await call('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
      return commit.sha;
    },
  };
}

module.exports = { client };
