import { spawnSync } from 'node:child_process';
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const defaultBase = repo ? (repo.toLowerCase() === `${owner}.github.io`.toLowerCase() ? '/' : `/${repo}/`) : '/the-gathering-table/';
const base = process.env.PAGES_BASE_HREF ?? defaultBase;
if (!/^\/(?:[A-Za-z0-9_.-]+\/)*$/.test(base)) throw new Error('PAGES_BASE_HREF must be a path starting and ending with /.');
const result = spawnSync(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'build', '--configuration', 'production', '--base-href', base], { stdio: 'inherit' });
process.exit(result.status ?? 1);
