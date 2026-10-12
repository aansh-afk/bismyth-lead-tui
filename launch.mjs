#!/usr/bin/env node
// Select an already installed supported Node runtime; never install or change it.
import {readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 20 || major === 20 && minor >= 19) {
  await import('./dist/index.js');
} else {
  const versionsDirectory = join(homedir(), '.nvm', 'versions', 'node');
  const versions = await readdir(versionsDirectory).catch(() => []);
  const supported = versions.filter(version => /^v\d+\.\d+\.\d+$/.test(version)).filter(version => {
    const [major, minor] = version.slice(1).split('.').map(Number);
    return major > 20 || major === 20 && minor >= 19;
  }).sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
  if (!supported.length) {
    console.error('This app needs Node >=20.19. Select a supported Node version, then run npm start.');
    process.exitCode = 1;
  } else {
    const result = spawnSync(join(versionsDirectory, supported[0], 'bin', 'node'), [fileURLToPath(new URL('./dist/index.js', import.meta.url)), ...process.argv.slice(2)], {stdio: 'inherit'});
    if (result.error) { console.error(result.error.message); process.exitCode = 1; }
    else process.exitCode = result.status ?? 1;
  }
}
