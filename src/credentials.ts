import {chmod, mkdir, open, readFile, rename, stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';

export function firecrawlKeyPath(directory: string): string { return join(directory, 'credentials', 'firecrawl.key'); }
function validKey(value: string): string {
  const key = value.trim();
  if (key.length < 10 || key.length > 4096 || /\s/.test(key)) throw new Error('Invalid Firecrawl key. Enter the key without spaces.');
  return key;
}
export async function firecrawlKey(directory: string): Promise<string | undefined> {
  if (process.env.FIRECRAWL_API_KEY?.trim()) return validKey(process.env.FIRECRAWL_API_KEY);
  const path = firecrawlKeyPath(directory);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > 4096) throw new Error('Invalid Firecrawl credential file. Run bismyth-leads firecrawl-login.');
    if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('Firecrawl key file must have private permissions (chmod 600).');
    return validKey(await readFile(path, 'utf8'));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
export async function saveFirecrawlKey(directory: string, value: string): Promise<void> {
  const key = validKey(value);
  const parent = join(directory, 'credentials');
  await mkdir(parent, {recursive: true, mode: 0o700}); await chmod(parent, 0o700);
  const path = firecrawlKeyPath(directory); const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(key + '\n'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}
export async function promptFirecrawlKey(directory: string): Promise<void> {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal for firecrawl-login, or set FIRECRAWL_API_KEY.');
  const silent = new Writable({write(_chunk, _encoding, callback) { callback(); }});
  const input = createInterface({input: process.stdin, output: silent, terminal: true});
  process.stdout.write('Firecrawl API key (hidden): ');
  try {
    const value = await new Promise<string>((resolve, reject) => {
      input.once('SIGINT', () => reject(new Error('Key entry cancelled.')));
      input.once('close', () => reject(new Error('Key entry cancelled.')));
      input.question('', resolve);
    });
    await saveFirecrawlKey(directory, value);
    process.stdout.write('\nFirecrawl key saved privately. No network request was made.\n');
  } finally { input.close(); silent.end(); }
}
