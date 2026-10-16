import type {Run, Config} from './model.js';
import {counts} from './model.js';
import {portalAccounts} from './accounts.js';
import type {PortalAccount} from './accounts.js';
import type {PublicContact} from './contacts.js';
import type {OutreachBook} from './outreach.js';

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
  accountSetup?: {accounts: PortalAccount[]; selected: number; busy: boolean; operation?: string};
  contacts?: PublicContact[]; contactSelection?: string[]; firecrawlStatus?: string; routerStatus?: string; outreach?: OutreachBook; senderSessionId?: string;
  dialog?: {title: string; body: string[]; choice: number; options: string[]; hint: string};
}
type MessageView = Pick<View, 'handoff' | 'notice'> & Partial<Pick<View, 'screen' | 'accountSetup'>>;
const accountControls = 'Enter Login  C Check  K Skip  N Profile  E Full message  Q Quit';
function messageText(view: MessageView, full = false): string {
  const message = view.handoff ? 'CHROME NEEDS YOU · ' + view.handoff : view.notice;
  if (!full || view.screen !== 0 || !view.accountSetup) return message;
  const selected = portalAccounts[Math.max(0, Math.min(portalAccounts.length - 1, view.accountSetup.selected))];
  const account = view.accountSetup.accounts.find(item => item.portal === selected.id);
  return [message, selected.label + ': ' + (account?.detail || 'Login has not been checked yet.')].filter(Boolean).join(' ');
}
function detailControls(compact: boolean, view: Pick<View, 'handoff'> & Partial<Pick<View, 'active' | 'run' | 'screen' | 'accountSetup'>>): string {
  if (view.screen === 0 && view.accountSetup?.busy) return 'Please wait for Chrome  Q Quit';
  if (compact) return '↑↓ Scroll  E Back  Q Quit';
  const navigation = '↑↓ Scroll  PgUp/PgDn Page  E/Esc Back  ';
  if (view.screen === 0 && view.accountSetup) return navigation + 'Enter Login  C Check  K Skip  N Profile  Q Quit';
  const paused = view.active && view.run?.state === 'paused';
  if (view.active && view.handoff) return navigation + (paused ? 'Enter/P Resume  C Recheck' : 'Enter/C Recheck') + '  K Skip  S Stop  Q Quit';
  if (view.active) return navigation + (paused ? 'Enter/P Resume' : 'P Pause') + '  S Stop  Q Quit';
  return navigation + 'Q Quit';
}
function footerControls(view: View, noticeContinues: boolean): string {
  const paused = view.active && view.run?.state === 'paused';
  if (view.screen === 0 && view.accountSetup) return view.accountSetup.busy ? 'Please wait for Chrome  Q Quit' : accountControls;
  if (view.handoff) return (paused ? 'Enter/P Resume  C Recheck' : 'Enter/C Recheck') + '  K Skip  S Stop  E Full message  Q Quit';
  if (noticeContinues) return (paused ? 'Enter/P Resume  ' : '') + 'E Full message  S Stop & save  1–5 Sections  Q Quit';
  if (paused) return 'Enter / P Resume    S Stop & save    1–5 Change view    Q Quit';
  if (view.active) return 'P Pause    S Stop & save    1–5 Change view    Q Quit';
  if (view.screen === 0) return 'Enter Edit    L Website logins    F / Ctrl+R Find properties    A Advanced    Q Quit';
  if ([1, 2].includes(view.screen) && !view.run?.projects.length) return 'Ctrl+R Find properties    1 Set up    1–5 Sections    Q Quit';
  if (view.screen === 1) return 'Enter / Ctrl+R Choose test or send  H Collect contacts  5 Contacts  X Export  Q Quit';
  if (view.screen === 2) return 'Enter / Ctrl+R Review queue  H Collect contacts  5 Contacts  X Export  Q Quit';
  if (view.screen === 4) return 'H Collect  Space Select  A Approve  Enter Review  W Batch  C Router  U Replies  O Export  E Evidence  Q Quit';
  return 'Enter Load run    X Export CSV    J Export JSON    1–5 Sections    ? Help    Q Quit';
}
export function messageDetailLayout(view: Pick<View, 'width' | 'height' | 'handoff' | 'notice' | 'details'> & Partial<Pick<View, 'active' | 'run' | 'screen' | 'accountSetup'>>): {lines: string[]; pageSize: number; maxOffset: number; offset: number} {
  const width = Math.max(20, view.width); const height = Math.max(8, view.height); const compact = width < 70 || height < 22;
  const contentWidth = compact ? width : width - 4;
  const controlsRows = wrap(detailControls(compact, view), contentWidth).length;
  const pageSize = Math.max(1, height - 1 - (compact ? 1 : 3) - (compact ? 1 : 2) - controlsRows - (compact ? 1 : 2));
  const lines = wrap(messageText(view, true), contentWidth);
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
  const accountBusy = view.screen === 0 && view.accountSetup?.busy;
  const status = accountBusy ? `${spinner} ${clean(view.accountSetup?.operation || 'Checking login')}` : view.active && view.stopping ? '■ Stopping · saving progress' : view.active && run?.state === 'paused' ? 'Ⅱ Paused · Enter resumes' : view.active && view.handoff ? '◆ Needs you in Chrome · Enter continues' : view.active && run?.state === 'discovering' ? `${spinner} Finding properties · ${elapsed}` : view.active && run?.state === 'enriching' ? `${spinner} Collecting contacts · ${elapsed}` : view.active && run?.state === 'messaging' ? `${spinner} WhatsApp task · ${elapsed}` : view.active && run?.state === 'running' ? `${spinner} ${run.config.mode === 'preview' ? 'Testing forms' : 'Sending enquiries'} · ${elapsed}` : run?.state === 'complete' ? '✓ Run finished' : run?.state === 'stopped' ? '■ Run stopped · progress saved' : run?.state === 'ready' ? '✓ Queue ready' : 'Run & results';
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
      if ((view.active || accountBusy) && height >= 10) compact.push(paint(cell(status, width), statusColor));
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
    detailLines.push(paint('  BISMYTH', ansi.cyan) + paint('  /  Atlas lead desk', ansi.faint));
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
  const names = ['Set up', 'Review queue', 'Run & results', 'Saved runs', 'Contacts'];
  lines.push(paint('  BISMYTH', ansi.cyan) + paint('  /  Atlas lead desk', ansi.faint) + (view.active || accountBusy ? paint('    ' + cell(status, width - Array.from('  BISMYTH  /  Atlas lead desk    ').length), statusColor) : ''));
  lines.push('  ' + paint(cell('AI · ' + view.auth, width - 5), view.auth.includes('connected') ? ansi.green : ansi.amber));
  lines.push(paint('  ' + '─'.repeat(width - 4), ansi.faint));
  if (!sidebar) lines.push('  ' + ['Set up', 'Review', 'Run', 'Saved', 'Contacts'].map((name, i) => paint(` ${i + 1} ${name} `, view.screen === i ? ansi.selected : ansi.faint)).join(' '));
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
    for (const text of ['1–5 or Tab   Change section', '↑ / ↓        Move selection', 'Enter        Edit / review / continue browser prompt / resume', 'L            Website logins inside Set up', 'Ctrl+R       Find properties or review the current queue', 'F            Find properties from your setup', 'A            Show or hide advanced settings', 'P            Pause or resume the browser', 'C / K        Check login / skip, or continue a run browser step', 'N            Continue from website logins to your profile', 'E            Read the full current message', 'S            Stop and save progress', 'H / 5        Collect public contacts / open Contacts', 'O / Shift+O  Export contacts CSV / JSON', 'W / U        Review WhatsApp batch / refresh replies', 'X / J        Export enquiry CSV / JSON', 'Q            Save progress and quit']) add(text);
  } else if (view.screen === 0 && view.accountSetup) {
    add('Set up · Website logins', ansi.bright);
    for (const line of wrap('Enter opens Chrome. C checks its current page.', area)) add(line, ansi.faint);
    for (const line of wrap('Enter passwords and OTPs in Chrome. N continues to your profile.', area)) add(line, ansi.faint);
    add('');
    const selected = Math.max(0, Math.min(portalAccounts.length - 1, view.accountSetup.selected));
    const portal = portalAccounts[selected];
    const current = view.accountSetup.accounts.find(account => account.portal === portal.id);
    const detail = wrap(current?.detail || 'Login has not been checked yet.', area);
    const date = current?.checkedAt;
    const timestamp = date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : date ? clean(date) : 'Not checked yet';
    const available = Math.max(1, maxBody - body.length - 4);
    const start = Math.max(0, Math.min(portalAccounts.length - available, selected - Math.floor(available / 2)));
    const labels = {'unchecked': 'Not checked', 'signed-in': 'Last verified', 'signed-out': 'Signed out', 'unknown': 'Unconfirmed', 'blocked': 'Blocked', 'skipped': 'Skipped'};
    for (const [offset, item] of portalAccounts.slice(start, start + available).entries()) {
      const account = view.accountSetup.accounts.find(value => value.portal === item.id);
      const status = account?.status || 'unchecked';
      add(`${start + offset === selected ? '›' : ' '} ${cell(item.label, 14)} ${cell(labels[status], 13)} ${item.integrated ? 'Listing adapter' : 'Login only'}`, start + offset === selected ? ansi.selected : status === 'signed-in' ? ansi.green : status === 'blocked' ? ansi.amber : ansi.text);
    }
    add(`↑↓ Choose website · ${selected + 1}/${portalAccounts.length}`, ansi.faint);
    add(`${current?.status === 'signed-in' ? 'Last verified' : 'Last checked'}: ${timestamp}`, ansi.faint);
    for (const line of detail.slice(0, 2)) add(line, current?.status === 'blocked' ? ansi.amber : ansi.faint);
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
      const bookings = run.projects.filter(item => item.status === 'submitted' && item.contactAction?.kind === 'visit-booking').length;
      const messages = run.projects.filter(item => item.status === 'submitted' && item.contactAction?.kind === 'portal-message').length;
      add(`${count.submitted - bookings - messages} interests · ${messages} messages · ${bookings} visits · ${count.prepared} tested`, ansi.green);
      add(`${count.uncertain} need review   ${count.skipped} skipped   ${count.queued} waiting`, ansi.faint);
      add(''); add('ACTIVITY', ansi.faint);
      const logs = run.events;
      const available = Math.max(1, maxBody - (run.state === 'complete' ? 10 : 8));
      const end = view.active ? logs.length : Math.min(logs.length, Math.max(available, view.selected[2] + 1));
      for (const event of logs.slice(Math.max(0, end - available), end)) add(event.at.slice(11, 19) + '  ' + event.message);
      if (run.state === 'complete') { add(''); add(run.config.mode === 'preview' ? 'Next: 2 Review queue → Enter → Send enquiries, or X to export.' : 'Next: X exports these results. 4 opens saved runs.', ansi.cyan); }
    }
  } else if (view.screen === 4) {
    const contacts = view.contacts || [];
    add('Contacts → Atlas outreach', ansi.bright);
    add('Firecrawl: ' + (view.firecrawlStatus || 'Not configured'), ansi.faint);
    add('Router: ' + (view.routerStatus || 'Not configured'), ansi.faint);
    add(`${contacts.length} unique contacts · ${contacts.filter(contact => contact.review === 'approved').length} approved · ${contacts.filter(contact => view.contactSelection?.includes(contact.id)).length} selected`, ansi.cyan);
    const captured = run?.projects.filter(item => item.contactCapture && item.contactCapture.status !== 'working').length || 0;
    add(`${captured}/${run?.projects.length || 0} pages checked · enquiry counts stay separate`, ansi.faint);
    if (!contacts.length) {
      add('Confirmed interests collect revealed portal contacts.');
      add('H optionally checks public listings with Firecrawl.');
      add('Hidden/masked numbers remain unavailable.', ansi.faint);
    } else {
      const available = Math.max(1, maxBody - 9); const selected = view.selected[4] || 0;
      const start = Math.max(0, selected - Math.floor(available / 2));
      for (const [offset, contact] of contacts.slice(start, start + available).entries()) {
        const state = view.outreach?.entries.filter(entry => entry.senderSessionId === view.senderSessionId && entry.to === contact.value).at(-1)?.status || contact.review;
        add(`${view.contactSelection?.includes(contact.id) ? '☑' : '☐'} ${cell(contact.value, 15)} ${cell(state, 13)} ${contact.name || contact.organization || contact.role || 'Identity needs review'}`, selected === start + offset ? ansi.selected : contact.review === 'approved' ? ansi.green : ansi.text);
      }
      const contact = contacts[selected];
      if (contact) { add('Source: ' + [...new Set((contact.attributions || [contact]).map(source => source.visibility || 'public'))].join(' + ') + ' · ' + contact.sourceUrl, ansi.faint); add('Evidence: ' + contact.evidence + ' · E reads all', ansi.faint); }
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
      const side = index === 0 ? 'WORKFLOW' : index >= 2 && index <= 6 ? `${index - 1}  ${names[index - 2]}` : index === 8 ? 'PLAYWRIGHT' : index === 9 ? 'Chrome session' : index === 11 ? 'CHATGPT' : index === 12 ? 'Subscription AI' : '';
      left = paint(cell(side, sidebar - 2), index >= 2 && index <= 6 && index - 2 === view.screen ? ansi.selected : ansi.faint) + paint('│ ', ansi.faint);
    }
    lines.push('  ' + left + pad(body[index] || '', area));
  }
  lines.push(paint('  ' + '─'.repeat(width - 4), ansi.faint));
  const noticeColor = view.handoff ? ansi.amber : view.screen === 0 && /login successful\./i.test(view.notice) ? ansi.green : ansi.faint;
  lines.push(...noticeLines.map(line => '  ' + paint(line, noticeColor)));
  lines.push(...footerLines.map(line => '  ' + paint(line, ansi.cyan)));
  if (view.editing || view.review !== undefined || view.picker || view.dialog) {
    const modalWidth = Math.min(width - 12, 68); const x = Math.floor((width - modalWidth) / 2);
    const contents = view.editing ? [view.editing.label, '', ...wrap(view.editing.hint, modalWidth - 6).slice(0, 2), '', '> ' + view.editing.buffer.slice(-(modalWidth - 9)) + '▏', '', 'Enter Save · Esc Cancel · Ctrl+U Clear'] : ['Choose how to run this queue', '', `${run?.projects.length || 0} ${run?.projects.length === 1 ? 'property' : 'properties'} · ${run?.config.city || ''}`, `${run?.config.name || ''} · ${run?.config.phone || ''}`, ...wrap('Atlas: share callback details. ' + (run?.projects.some(item => item.site === 'nobroker') ? 'NoBroker can book a real visit using its account phone. ' : '') + 'E explains the flow and chat text.', modalWidth - 6), '', ...['Test forms — fills details, no final submit', 'Send enquiries — submits your contact details', 'Back to queue'].map((text, i) => `${i === view.review ? '›' : ' '} ${text}`), '', '↑↓ Choose · Enter Start · E Details · Esc Cancel'];
    if (view.picker) {
      const start = Math.max(0, view.picker.selected - 3);
      contents.splice(0, contents.length, view.picker.title, '', 'Search: ' + view.picker.query + '▏', '', ...view.picker.choices.slice(start, start + 6).map((choice, index) => `${start + index === view.picker!.selected ? '›' : ' '} ${choice}`), '', view.picker.choices.length ? `${view.picker.choices.length} matches · ↑↓ Select · Enter Choose · Esc Cancel` : 'No matches. Backspace changes your search.');
    }
    if (view.dialog) {
      const body = view.dialog.body.flatMap(text => wrap(text, modalWidth - 4));
      const bodyLimit = Math.max(2, height - view.dialog.options.length - 9);
      const visible = body.length > bodyLimit ? [...body.slice(0, bodyLimit - 1), 'E reads the complete message and sources.'] : body;
      contents.splice(0, contents.length, view.dialog.title, '', ...visible, '', ...view.dialog.options.map((option, index) => `${view.dialog!.choice === index ? '›' : ' '} ${option}`), '', view.dialog.hint);
    }
    const overlay = [paint('╭' + '─'.repeat(modalWidth - 2) + '╮', ansi.cyan), ...contents.map((line, i) => paint('│ ', ansi.cyan) + paint(cell(line, modalWidth - 4), i === 0 ? ansi.bright : line.startsWith('›') ? ansi.selected : ansi.text) + paint(' │', ansi.cyan)), paint('╰' + '─'.repeat(modalWidth - 2) + '╯', ansi.cyan)];
    const y = Math.max(1, Math.floor((height - overlay.length) / 2));
    let result = '\x1b[H' + lines.slice(0, height - 1).map(line => line + '\x1b[K').join('\r\n') + '\x1b[J';
    for (let i = 0; i < overlay.length && y + i < height; i++) result += `\x1b[${y + i};${x}H` + overlay[i];
    return result;
  }
  return '\x1b[H' + lines.slice(0, height - 1).map(line => line + '\x1b[K').join('\r\n') + '\x1b[J';
}
