import type {Run, Config} from './model.js';
import {counts} from './model.js';

const ansi = {reset: '\x1b[0m', faint: '\x1b[38;5;245m', text: '\x1b[38;5;252m', bright: '\x1b[97m', cyan: '\x1b[38;5;80m', green: '\x1b[38;5;114m', amber: '\x1b[38;5;179m', selected: '\x1b[48;5;24m\x1b[97m'};
export function clean(value: unknown): string { return String(value).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').trim(); }
function plain(value: string): string { return value.replace(/\x1b\[[0-9;]*m/g, ''); }
function cell(value: unknown, width: number): string {
  const text = Array.from(clean(value));
  return (text.length > width ? text.slice(0, Math.max(0, width - 1)).join('') + '…' : text.join('')).padEnd(Math.max(0, width));
}
function paint(text: string, color = ansi.text): string { return color + text + ansi.reset; }
function pad(text: string, width: number): string { return text + ' '.repeat(Math.max(0, width - Array.from(plain(text)).length)); }
function wrap(text: string, width: number): string[] {
  const result: string[] = []; let line = '';
  for (const word of clean(text).split(' ')) {
    if (line.length + word.length + 1 > width && line) { result.push(line); line = ''; }
    line += (line ? ' ' : '') + word;
  }
  if (line) result.push(line); return result;
}
export interface View {
  width: number; height: number; screen: number; selected: number[]; config: Config;
  run?: Run; history: Run[]; fields: {index: number; label: string; value: string; hint: string}[];
  advanced: boolean; notice: string; help: boolean; handoff: string; active: boolean;
  auth: string; editing?: {label: string; buffer: string; hint: string}; review?: number;
  picker?: {title: string; query: string; selected: number; choices: string[]};
}
export function renderView(view: View): string {
  const width = Math.max(20, view.width); const height = Math.max(8, view.height);
  if (width < 70 || height < 22) return '\x1b[H' + paint('Bismyth · Enquiry desk', ansi.cyan) + '\r\nResize your terminal to at least 70 × 22.\r\nYour run keeps its progress. Q exits.\x1b[J';
  const sidebar = width >= 100 ? 21 : 0;
  const area = width - sidebar - 6;
  const lines: string[] = [];
  const names = ['Set up', 'Review queue', 'Run & results', 'Saved runs'];
  lines.push(paint('  BISMYTH', ansi.cyan) + paint('  /  enquiry desk', ansi.faint));
  lines.push('  ' + paint(cell('AI · ' + view.auth, width - 5), view.auth.includes('connected') ? ansi.green : ansi.amber));
  lines.push(paint('  ' + '─'.repeat(width - 4), ansi.faint));
  if (!sidebar) lines.push('  ' + names.map((name, i) => paint(` ${i + 1} ${name} `, view.screen === i ? ansi.selected : ansi.faint)).join(' '));
  const body: string[] = [];
  const add = (text = '', color = ansi.text): void => { body.push(paint(cell(text, area), color)); };
  const run = view.run; const count = run ? counts(run) : undefined;
  if (view.help) {
    add('Keyboard guide', ansi.bright); add('');
    for (const text of ['1–4 or Tab   Change section', '↑ / ↓        Move selection', 'Enter        Edit a field / review and start / load a saved run', 'F            Find properties from your setup', 'A            Show or hide advanced settings', 'P            Pause or resume the browser', 'C / K        Continue after a browser step / skip it', 'S            Stop and save progress', 'X / J        Export CSV / JSON', 'Q            Save progress and quit']) add(text);
  } else if (view.screen === 0) {
    add(view.advanced ? 'Advanced settings' : 'Start a property enquiry run', ansi.bright);
    add(view.advanced ? 'Optional settings. A returns to the guided setup.' : 'Fill in these details, then press F to find properties.', ansi.faint);
    add('');
    const available = height - (sidebar ? 13 : 14);
    const selected = view.selected[0];
    const index = Math.max(0, view.fields.findIndex(field => field.index === selected));
    const start = Math.max(0, index - Math.floor(available / 2));
    for (const field of view.fields.slice(start, start + available)) {
      const text = `${field.index === selected ? '›' : ' '} ${cell(field.label, 19)}  ${field.value || 'Enter to add…'}`;
      add(text, field.index === selected ? ansi.selected : ansi.text);
    }
    add('');
    add(view.fields.find(field => field.index === selected)?.hint || '', ansi.faint);
  } else if (view.screen === 1) {
    add('Review your property queue', ansi.bright);
    add(run ? `${run.projects.length} ${run.projects.length === 1 ? 'property' : 'properties'} · ${run.config.city} · ${run.config.intent === 'buy' ? 'Buying' : 'Renting'}` : 'Find properties first, then choose a test or a live run.', ansi.faint);
    add('');
    if (!run?.projects.length) {
      add('Nothing in your queue yet.', ansi.bright); add('');
      add('1  Go to Set up and enter your city and contact details.');
      add('2  Press F to find properties across the selected websites.');
      add('3  Return here to review the list and press Enter.');
    } else {
      add(`${cell('WEBSITE', 10)} ${cell('STATE', 11)} PROPERTY`, ansi.faint);
      const start = Math.max(0, view.selected[1] - Math.floor((height - 16) / 2));
      for (const [offset, item] of run.projects.slice(start, start + height - 15).entries()) add(`${cell(item.site, 10)} ${cell(item.status, 11)} ${item.title}`, start + offset === view.selected[1] ? ansi.selected : item.status === 'submitted' ? ansi.green : ansi.text);
      add('');
      const item = run.projects[view.selected[1]];
      if (item) { add(item.detail || 'Ready to review. Enter chooses how to run this queue.', ansi.faint); add(item.url, ansi.faint); }
    }
  } else if (view.screen === 2) {
    add(run?.state === 'complete' ? 'Your run has finished' : view.active ? 'Browser working' : 'Run & results', ansi.bright);
    add(run ? `${run.config.city} · ${run.config.mode === 'preview' ? 'Test forms' : 'Send enquiries'} · ${run.state}` : 'Review a queue and choose a run to see progress here.', ansi.faint);
    add('');
    if (run && count) {
      const done = run.projects.length - count.queued - count.working;
      const size = Math.min(32, area - 15); const filled = run.projects.length ? Math.round(size * done / run.projects.length) : 0;
      add(`${'━'.repeat(filled)}${'─'.repeat(size - filled)}  ${done}/${run.projects.length} checked`, ansi.cyan);
      add(`${count.submitted} confirmed   ${count.prepared} forms tested   ${count.failed} failed`, ansi.green);
      add(`${count.uncertain} need review   ${count.skipped} skipped   ${count.queued} waiting`, ansi.faint);
      add(''); add('ACTIVITY', ansi.faint);
      const logs = run.events;
      const end = view.active ? logs.length : Math.min(logs.length, Math.max(height - 18, view.selected[2] + 1));
      for (const event of logs.slice(Math.max(0, end - (height - 18)), end)) add(event.at.slice(11, 19) + '  ' + event.message);
      if (run.state === 'complete') { add(''); add(run.config.mode === 'preview' ? 'Next: 2 Review queue → Enter → Send enquiries, or X to export.' : 'Next: X exports these results. 4 opens saved runs.', ansi.cyan); }
    }
  } else {
    add('Saved runs', ansi.bright); add('Enter loads a run. X exports CSV. Your progress is kept locally.', ansi.faint); add('');
    if (!view.history.length) { add('Your first run will appear here.', ansi.bright); add('Go to Set up to get started.', ansi.faint); }
    const start = Math.max(0, view.selected[3] - Math.floor((height - 13) / 2));
    for (const [offset, item] of view.history.slice(start, start + height - 12).entries()) add(`${item.createdAt.slice(5, 16).replace('T', ' ')}  ${cell(item.config.city, 12)} ${cell(item.state, 9)} ${counts(item).submitted} confirmed`, start + offset === view.selected[3] ? ansi.selected : ansi.text);
  }
  const maxBody = height - (sidebar ? 8 : 9);
  for (let index = 0; index < maxBody; index++) {
    let left = '';
    if (sidebar) {
      const side = index === 0 ? 'WORKFLOW' : index >= 2 && index <= 5 ? `${index - 1}  ${names[index - 2]}` : index === 8 ? 'PLAYWRIGHT' : index === 9 ? 'Chrome session' : index === 11 ? 'CHATGPT' : index === 12 ? 'Subscription AI' : '';
      left = paint(cell(side, sidebar - 2), index >= 2 && index <= 5 && index - 2 === view.screen ? ansi.selected : ansi.faint) + paint('│ ', ansi.faint);
    }
    lines.push('  ' + left + pad(body[index] || '', area));
  }
  lines.push(paint('  ' + '─'.repeat(width - 4), ansi.faint));
  const notice = view.handoff ? 'CHROME NEEDS YOU · ' + view.handoff : view.notice;
  lines.push('  ' + paint(cell(notice, width - 4), view.handoff ? ansi.amber : ansi.faint));
  const footer = view.handoff ? 'C Continue after completing the browser step    K Skip    S Stop' : view.active ? 'P Pause / resume    S Stop & save    1–4 Change view    Q Quit' : view.screen === 0 ? 'Enter Edit    F Find properties    A Advanced    Tab Next section    Q Quit' : view.screen === 1 ? 'Enter Choose test / send run    ↑↓ Review list    X Export    1 Set up    Q Quit' : 'Enter Load run    X Export CSV    J Export JSON    1–4 Sections    ? Help    Q Quit';
  lines.push('  ' + paint(cell(footer, width - 4), ansi.cyan));
  if (view.editing || view.review !== undefined || view.picker) {
    const modalWidth = Math.min(width - 12, 68); const x = Math.floor((width - modalWidth) / 2); const y = Math.max(4, Math.floor(height / 2) - 5);
    const contents = view.editing ? [view.editing.label, '', ...wrap(view.editing.hint, modalWidth - 6).slice(0, 2), '', '> ' + view.editing.buffer.slice(-(modalWidth - 9)) + '▏', '', 'Enter Save · Esc Cancel · Ctrl+U Clear'] : ['Choose how to run this queue', '', `${run?.projects.length || 0} ${run?.projects.length === 1 ? 'property' : 'properties'} · ${run?.config.city || ''}`, `${run?.config.name || ''} · ${run?.config.phone || ''}`, '', ...['Test forms — fills details, no final submit', 'Send enquiries — submits your contact details', 'Back to queue'].map((text, i) => `${i === view.review ? '›' : ' '} ${text}`), '', '↑↓ Choose · Enter Start · Esc Cancel'];
    if (view.picker) {
      const start = Math.max(0, view.picker.selected - 3);
      contents.splice(0, contents.length, view.picker.title, '', 'Search: ' + view.picker.query + '▏', '', ...view.picker.choices.slice(start, start + 6).map((choice, index) => `${start + index === view.picker!.selected ? '›' : ' '} ${choice}`), '', view.picker.choices.length ? `${view.picker.choices.length} matches · ↑↓ Select · Enter Choose · Esc Cancel` : 'No matches. Backspace changes your search.');
    }
    const overlay = [paint('╭' + '─'.repeat(modalWidth - 2) + '╮', ansi.cyan), ...contents.map((line, i) => paint('│ ', ansi.cyan) + paint(cell(line, modalWidth - 4), i === 0 ? ansi.bright : line.startsWith('›') ? ansi.selected : ansi.text) + paint(' │', ansi.cyan)), paint('╰' + '─'.repeat(modalWidth - 2) + '╯', ansi.cyan)];
    let result = '\x1b[H' + lines.slice(0, height - 1).map(line => line + '\x1b[K').join('\r\n') + '\x1b[J';
    for (let i = 0; i < overlay.length && y + i < height; i++) result += `\x1b[${y + i};${x}H` + overlay[i];
    return result;
  }
  return '\x1b[H' + lines.slice(0, height - 1).map(line => line + '\x1b[K').join('\r\n') + '\x1b[J';
}
