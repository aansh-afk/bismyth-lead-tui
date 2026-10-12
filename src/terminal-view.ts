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
  const limit = Math.max(1, width); const result: string[] = []; let line: string[] = [];
  for (const word of clean(text).split(/\s+/).filter(Boolean)) {
    const letters = Array.from(word);
    if (line.length && line.length + letters.length + 1 > limit) { result.push(line.join('')); line = []; }
    while (letters.length > limit) { result.push(letters.splice(0, limit).join('')); }
    if (letters.length) line.push(...(line.length ? [' '] : []), ...letters);
  }
  if (line.length) result.push(line.join('')); return result;
}
export interface View {
  width: number; height: number; screen: number; selected: number[]; config: Config;
  run?: Run; history: Run[]; fields: {index: number; label: string; value: string; hint: string}[];
  advanced: boolean; notice: string; help: boolean; handoff: string; active: boolean;
  auth: string; editing?: {label: string; buffer: string; hint: string}; review?: number;
  picker?: {title: string; query: string; selected: number; choices: string[]};
  animationFrame?: number; elapsedMs?: number; stopping?: boolean;
  details?: {offset: number};
}
function messageText(view: Pick<View, 'handoff' | 'notice'>): string { return view.handoff ? 'CHROME NEEDS YOU · ' + view.handoff : view.notice; }
function detailControls(compact: boolean, view: Pick<View, 'handoff'> & Partial<Pick<View, 'active' | 'run'>>): string {
  if (compact) return '↑↓ Scroll  E Back  Q Quit';
  const navigation = '↑↓ Scroll  PgUp/PgDn Page  E/Esc Back  ';
  const paused = view.active && view.run?.state === 'paused';
  if (view.active && view.handoff) return navigation + (paused ? 'Enter/P Resume  C Recheck' : 'Enter/C Recheck') + '  K Skip  S Stop  Q Quit';
  if (view.active) return navigation + (paused ? 'Enter/P Resume' : 'P Pause') + '  S Stop  Q Quit';
  return navigation + 'Q Quit';
}
function footerControls(view: View, noticeContinues: boolean): string {
  const paused = view.active && view.run?.state === 'paused';
  if (view.handoff) return (paused ? 'Enter/P Resume  C Recheck' : 'Enter/C Recheck') + '  K Skip  S Stop  E Full message  Q Quit';
  if (noticeContinues) return (paused ? 'Enter/P Resume  ' : '') + 'E Full message  S Stop & save  1–4 Sections  Q Quit';
  if (paused) return 'Enter / P Resume    S Stop & save    1–4 Change view    Q Quit';
  if (view.active) return 'P Pause    S Stop & save    1–4 Change view    Q Quit';
  if (view.screen === 0) return 'Enter Edit    F / Ctrl+R Find properties    A Advanced    Q Quit';
  if ([1, 2].includes(view.screen) && !view.run?.projects.length) return 'Ctrl+R Find properties    1 Set up    1–4 Sections    Q Quit';
  if (view.screen === 1) return 'Enter / Ctrl+R Choose test or send    ↑↓ Review    X Export    Q Quit';
  if (view.screen === 2) return 'Enter / Ctrl+R Review queue    X Export    1–4 Sections    Q Quit';
  return 'Enter Load run    X Export CSV    J Export JSON    1–4 Sections    ? Help    Q Quit';
}
export function messageDetailLayout(view: Pick<View, 'width' | 'height' | 'handoff' | 'notice' | 'details'> & Partial<Pick<View, 'active' | 'run'>>): {lines: string[]; pageSize: number; maxOffset: number; offset: number} {
  const width = Math.max(20, view.width); const height = Math.max(8, view.height); const compact = width < 70 || height < 22;
  const contentWidth = compact ? width : width - 4;
  const controlsRows = wrap(detailControls(compact, view), contentWidth).length;
  const pageSize = Math.max(1, height - 1 - (compact ? 1 : 3) - (compact ? 1 : 2) - controlsRows - (compact ? 1 : 2));
  const lines = wrap(messageText(view), contentWidth);
  if (!lines.length) lines.push('No current message.');
  const maxOffset = Math.max(0, lines.length - pageSize);
  const offset = Math.min(maxOffset, Math.max(0, Math.floor(view.details?.offset || 0)));
  return {lines, pageSize, maxOffset, offset};
}
export function renderView(view: View): string {
  const width = Math.max(20, view.width); const height = Math.max(8, view.height);
  const run = view.run;
  const seconds = Math.floor(Math.max(0, view.elapsedMs || 0) / 1000);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][(view.animationFrame || 0) % 10];
  const status = view.active && view.stopping ? '■ Stopping · saving progress' : view.active && run?.state === 'paused' ? 'Ⅱ Paused · Enter resumes' : view.active && view.handoff ? '◆ Needs you in Chrome · Enter continues' : view.active && run?.state === 'discovering' ? `${spinner} Finding properties · ${elapsed}` : view.active && run?.state === 'running' ? `${spinner} ${run.config.mode === 'preview' ? 'Testing forms' : 'Sending enquiries'} · ${elapsed}` : run?.state === 'complete' ? '✓ Run finished' : run?.state === 'stopped' ? '■ Run stopped · progress saved' : run?.state === 'ready' ? '✓ Queue ready' : 'Run & results';
  const statusColor = view.stopping || run?.state === 'paused' || view.handoff ? ansi.amber : ansi.cyan;
  if (width < 70 || height < 22) {
    const compact: string[] = [paint(cell('Bismyth · Enquiry desk', width), ansi.cyan)];
    if (view.details) {
      const details = messageDetailLayout(view);
      compact.push(paint('Full message', ansi.bright));
      for (const line of details.lines.slice(details.offset, details.offset + details.pageSize)) compact.push(paint(line, view.handoff ? ansi.amber : ansi.text));
      while (compact.length < 2 + details.pageSize) compact.push('');
      compact.push(paint(cell(`Lines ${details.offset + 1}–${Math.min(details.lines.length, details.offset + details.pageSize)} of ${details.lines.length}`, width), ansi.faint));
      compact.push(...wrap(detailControls(true, view), width).map(line => paint(line, ansi.cyan)));
    } else {
      if (view.active && height >= 10) compact.push(paint(cell(status, width), statusColor));
      compact.push(...wrap('Resize to at least 70 × 22.', width).map(line => paint(line, ansi.faint)));
      const footer = wrap(messageText(view) ? 'E Full message  Q Quit' : 'Q Quit', width);
      const room = Math.max(0, height - 1 - compact.length - footer.length);
      const reason = wrap(messageText(view), width);
      compact.push(...reason.slice(0, room).map(line => paint(line, view.handoff ? ansi.amber : ansi.faint)));
      compact.push(...footer.map(line => paint(line, ansi.cyan)));
    }
    return '\x1b[H' + compact.slice(0, height - 1).map(line => line + '\x1b[K').join('\r\n') + '\x1b[J';
  }
  if (view.details) {
    const details = messageDetailLayout(view); const detailLines: string[] = [];
    detailLines.push(paint('  BISMYTH', ansi.cyan) + paint('  /  enquiry desk', ansi.faint));
    detailLines.push('  ' + paint(cell('AI · ' + view.auth, width - 4), view.auth.includes('connected') ? ansi.green : ansi.amber));
    detailLines.push(paint('  ' + '─'.repeat(width - 4), ansi.faint));
    detailLines.push('  ' + paint('Full message', ansi.bright)); detailLines.push('');
    for (let row = 0; row < details.pageSize; row++) detailLines.push('  ' + paint(details.lines[details.offset + row] || '', view.handoff ? ansi.amber : ansi.text));
    detailLines.push(paint('  ' + '─'.repeat(width - 4), ansi.faint));
    detailLines.push('  ' + paint(`Lines ${details.offset + 1}–${Math.min(details.lines.length, details.offset + details.pageSize)} of ${details.lines.length}`, ansi.faint));
    detailLines.push(...wrap(detailControls(false, view), width - 4).map(line => '  ' + paint(line, ansi.cyan)));
    return '\x1b[H' + detailLines.slice(0, height - 1).map(line => line + '\x1b[K').join('\r\n') + '\x1b[J';
  }
  const sidebar = width >= 100 ? 21 : 0;
  const area = width - sidebar - 6;
  const lines: string[] = [];
  const names = ['Set up', 'Review queue', 'Run & results', 'Saved runs'];
  lines.push(paint('  BISMYTH', ansi.cyan) + paint('  /  enquiry desk', ansi.faint) + (view.active ? paint('    ' + cell(status, width - 30), statusColor) : ''));
  lines.push('  ' + paint(cell('AI · ' + view.auth, width - 5), view.auth.includes('connected') ? ansi.green : ansi.amber));
  lines.push(paint('  ' + '─'.repeat(width - 4), ansi.faint));
  if (!sidebar) lines.push('  ' + ['Set up', 'Review', 'Run', 'Saved'].map((name, i) => paint(` ${i + 1} ${name} `, view.screen === i ? ansi.selected : ansi.faint)).join(' '));
  const wrappedNotice = wrap(messageText(view), width - 4);
  const noticeContinues = wrappedNotice.length > 6;
  const noticeLines = noticeContinues ? [...wrappedNotice.slice(0, 5), 'Message continues. E Full message'] : wrappedNotice.length ? wrappedNotice : [''];
  const footerLines = wrap(footerControls(view, noticeContinues), width - 4);
  const maxBody = height - 1 - lines.length - noticeLines.length - 1 - footerLines.length;
  const body: string[] = [];
  const add = (text = '', color = ansi.text): void => { body.push(paint(cell(text, area), color)); };
  const count = run ? counts(run) : undefined;
  if (view.help) {
    add('Keyboard guide', ansi.bright); add('');
    for (const text of ['1–4 or Tab   Change section', '↑ / ↓        Move selection', 'Enter        Edit / review / continue browser prompt / resume', 'Ctrl+R       Find properties or review the current queue', 'F            Find properties from your setup', 'A            Show or hide advanced settings', 'P            Pause or resume the browser', 'C / K        Continue after a browser step / skip it', 'E            Read the full current message', 'S            Stop and save progress', 'X / J        Export CSV / JSON', 'Q            Save progress and quit']) add(text);
  } else if (view.screen === 0) {
    add(view.advanced ? 'Advanced settings' : 'Start a property enquiry run', ansi.bright);
    add(view.advanced ? 'Optional settings. A returns to the guided setup.' : 'Enter edits a field. F or Ctrl+R finds properties.', ansi.faint);
    add('');
    const available = Math.max(1, maxBody - 5);
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
    if (run?.projects.length) add('Enter / Ctrl+R → choose Test forms or Send enquiries', ansi.cyan);
    add('');
    if (!run?.projects.length) {
      add('Nothing in your queue yet.', ansi.bright); add('');
      add('1  Go to Set up and enter your city and contact details.');
      add('2  Press F to find properties across the selected websites.');
      add('3  Return here to review the list and press Enter.');
    } else {
      add(`${cell('WEBSITE', 10)} ${cell('STATE', 11)} PROPERTY`, ansi.faint);
      const available = Math.max(1, maxBody - 8);
      const start = Math.max(0, view.selected[1] - Math.floor(available / 2));
      for (const [offset, item] of run.projects.slice(start, start + available).entries()) add(`${cell(item.site, 10)} ${cell(item.status, 11)} ${item.title}`, start + offset === view.selected[1] ? ansi.selected : item.status === 'submitted' ? ansi.green : ansi.text);
      add('');
      const item = run.projects[view.selected[1]];
      if (item) { add(item.detail || 'Ready to review. Enter chooses how to run this queue.', ansi.faint); add(item.url, ansi.faint); }
    }
  } else if (view.screen === 2) {
    add(status, view.active ? statusColor : ansi.bright);
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
      const available = Math.max(1, maxBody - (run.state === 'complete' ? 10 : 8));
      const end = view.active ? logs.length : Math.min(logs.length, Math.max(available, view.selected[2] + 1));
      for (const event of logs.slice(Math.max(0, end - available), end)) add(event.at.slice(11, 19) + '  ' + event.message);
      if (run.state === 'complete') { add(''); add(run.config.mode === 'preview' ? 'Next: 2 Review queue → Enter → Send enquiries, or X to export.' : 'Next: X exports these results. 4 opens saved runs.', ansi.cyan); }
    }
  } else {
    add('Saved runs', ansi.bright); add('Enter loads a run. X exports CSV. Your progress is kept locally.', ansi.faint); add('');
    if (!view.history.length) { add('Your first run will appear here.', ansi.bright); add('Go to Set up to get started.', ansi.faint); }
    const available = Math.max(1, maxBody - 3);
    const start = Math.max(0, view.selected[3] - Math.floor(available / 2));
    for (const [offset, item] of view.history.slice(start, start + available).entries()) add(`${item.createdAt.slice(5, 16).replace('T', ' ')}  ${cell(item.config.city, 12)} ${cell(item.state, 9)} ${counts(item).submitted} confirmed`, start + offset === view.selected[3] ? ansi.selected : ansi.text);
  }
  for (let index = 0; index < maxBody; index++) {
    let left = '';
    if (sidebar) {
      const side = index === 0 ? 'WORKFLOW' : index >= 2 && index <= 5 ? `${index - 1}  ${names[index - 2]}` : index === 8 ? 'PLAYWRIGHT' : index === 9 ? 'Chrome session' : index === 11 ? 'CHATGPT' : index === 12 ? 'Subscription AI' : '';
      left = paint(cell(side, sidebar - 2), index >= 2 && index <= 5 && index - 2 === view.screen ? ansi.selected : ansi.faint) + paint('│ ', ansi.faint);
    }
    lines.push('  ' + left + pad(body[index] || '', area));
  }
  lines.push(paint('  ' + '─'.repeat(width - 4), ansi.faint));
  lines.push(...noticeLines.map(line => '  ' + paint(line, view.handoff ? ansi.amber : ansi.faint)));
  lines.push(...footerLines.map(line => '  ' + paint(line, ansi.cyan)));
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
