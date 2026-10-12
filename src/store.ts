import {mkdir, readFile, rename, readdir, open, chmod} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaults, duplicateKey, recoverRun} from './model.js';
import type {Config, Run} from './model.js';
import {stateForCity} from './locations.js';

export class Store {
  readonly directory: string;
  constructor(directory = process.env.BISMYTH_TUI_DATA || join(homedir(), '.local', 'share', 'bismyth-lead-tui')) { this.directory = directory; }
  async init(): Promise<void> {
    await mkdir(join(this.directory, 'runs'), {recursive: true, mode: 0o700});
    await chmod(this.directory, 0o700);
    await chmod(join(this.directory, 'runs'), 0o700);
  }
  async write(name: string, value: unknown): Promise<void> {
    await this.init();
    const path = join(this.directory, name);
    const temporary = path + '.' + randomUUID() + '.tmp';
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
  }
  async config(): Promise<Config> {
    try {
      const config = {...structuredClone(defaults), ...JSON.parse(await readFile(join(this.directory, 'config.json'), 'utf8'))} as Config;
      config.stateCode ||= stateForCity(config.city)?.code || '';
      return config;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(defaults); throw error; }
  }
  saveConfig(config: Config): Promise<void> { return this.write('config.json', config); }
  async save(run: Run): Promise<void> {
    run.updatedAt = new Date().toISOString();
    await this.write('runs/' + this.validId(run.id) + '.json', run);
  }
  validId(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid run ID.');
    return id;
  }
  async load(id: string): Promise<Run> {
    const run = JSON.parse(await readFile(join(this.directory, 'runs', this.validId(id) + '.json'), 'utf8')) as Run;
    if (run.version !== 1 || run.id !== id || !Array.isArray(run.projects)) throw new Error('Invalid run file.');
    return recoverRun(run);
  }
  async history(): Promise<Run[]> {
    await this.init();
    const names = (await readdir(join(this.directory, 'runs'))).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    const result = await Promise.all(names.map(name => this.load(name.slice(0, -5))));
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async priorContacts(excludeId: string): Promise<Set<string>> {
    const result = new Set<string>();
    for (const run of await this.history()) if (run.id !== excludeId && run.config.mode === 'submit') {
      for (const item of run.projects) if (['submitted', 'uncertain'].includes(item.status)) result.add(duplicateKey(run.config, item));
    }
    return result;
  }
  async export(run: Run, format: 'json' | 'csv'): Promise<string> {
    const name = run.id + '.' + format;
    if (format === 'json') await this.write(name, run);
    else {
      const cell = (value: string): string => '"' + (/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
      const lines = ['site,title,url,status,detail,updatedAt', ...run.projects.map(item => [item.site, item.title, item.url, item.status, item.detail, item.updatedAt].map(cell).join(','))];
      await this.init();
      const handle = await open(join(this.directory, name), 'w', 0o600);
      try { await handle.writeFile(lines.join('\r\n') + '\r\n'); } finally { await handle.close(); }
    }
    return join(this.directory, name);
  }
}
