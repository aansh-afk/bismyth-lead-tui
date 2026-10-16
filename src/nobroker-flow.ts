import type {Locator, Page} from 'playwright-core';

export interface NoBrokerVisitPreparation {detected: boolean; ready: boolean; reason: string; summary?: string}
interface Selection {url: string; date: number; dayLabel: string; timeLabel: string; summary: string}
const selections = new WeakMap<Page, Selection>();
const attempted = new WeakMap<Page, Set<string>>();
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

async function usable(control: Locator): Promise<boolean> {
  return control.evaluate(node => {
    if (!(node instanceof HTMLElement) || !node.isConnected || node.matches(':disabled')) return false;
    for (let current: HTMLElement | null = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hidden || current.hasAttribute('inert') || current.getAttribute('aria-disabled') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
    }
    const rectangle = node.getBoundingClientRect();
    return rectangle.width > 0 && rectangle.height > 0;
  }).catch(() => false);
}
async function selected(control: Locator): Promise<boolean> {
  return control.evaluate(node => node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('data-selected') === 'true' || /(?:border-\[#409386\]|bg-\[#(?:EAFAF7|E5F4F3)\]|text-\[#409386\])/.test(node.className)).catch(() => false);
}
async function calendarFor(page: Page): Promise<Locator | undefined> {
  const calendars = page.locator('.calender-compoent');
  const visible: Locator[] = [];
  for (let index = 0; index < await calendars.count(); index++) if (await calendars.nth(index).isVisible()) visible.push(calendars.nth(index));
  return visible.length === 1 ? visible[0] : undefined;
}
async function schedulingHeader(page: Page): Promise<boolean> {
  const header = page.locator('.schedule-visit-header-container').filter({visible: true});
  return await header.count() === 1 && /^schedule\s+(?:your\s+free\s+visit|visit\s+for\s+free)\b/i.test((await header.innerText()).trim());
}
async function waitUntil(page: Page, checkpoint: () => Promise<void>, condition: () => Promise<boolean>): Promise<boolean> {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    await checkpoint();
    if (await condition()) return true;
    await page.waitForTimeout(100);
  }
  return false;
}
async function dates(calendar: Locator): Promise<{control: Locator; epoch: number; label: string}[]> {
  const heading = calendar.getByRole('heading', {name: 'Pick a Date', exact: true});
  if (await heading.count() !== 1) return [];
  const area = heading.locator('..');
  const raw = await area.evaluate(node => {
    const buttons = [...node.querySelectorAll<HTMLButtonElement>('button')];
    const row = [...node.children].find(child => child.querySelector('button'));
    let marker = '';
    const result: {index: number; label: string; marker: string; full: string}[] = [];
    for (const child of row?.children ?? []) {
      const text = (child.textContent || '').trim().replace(/\s+/g, ' ');
      if (child.matches('button')) result.push({index: buttons.indexOf(child as HTMLButtonElement), label: text, marker, full: child.getAttribute('data-date') || child.getAttribute('datetime') || child.getAttribute('aria-label') || ''});
      else if (/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{4})?$/i.test(text)) marker = text;
    }
    return result;
  });
  const now = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric'}).formatToParts(new Date());
  let year = Number(now.find(part => part.type === 'year')!.value);
  let previousMonth = Number(now.find(part => part.type === 'month')!.value) - 1;
  const result: {control: Locator; epoch: number; label: string}[] = [];
  for (const entry of raw) {
    const day = /^(\d{1,2})(?:\s+(?:Today|Sun|Mon|Tue|Wed|Thu|Fri|Sat))?$/i.exec(entry.label)?.[1];
    const explicit = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(entry.full);
    const month = entry.marker ? months.indexOf(entry.marker.slice(0, 3).toLowerCase()) : -1;
    if (!explicit && (!day || month < 0)) continue;
    const explicitYear = /\b(\d{4})$/.exec(entry.marker)?.[1];
    if (explicitYear) year = Number(explicitYear);
    else if (!explicit && month < previousMonth) year++;
    if (!explicit) previousMonth = month;
    const selectedYear = explicit ? Number(explicit[1]) : year;
    const selectedMonth = explicit ? Number(explicit[2]) - 1 : month;
    const selectedDay = Number(explicit?.[3] ?? day);
    const epoch = Date.UTC(selectedYear, selectedMonth, selectedDay);
    const date = new Date(epoch);
    if (date.getUTCFullYear() !== selectedYear || date.getUTCMonth() !== selectedMonth || date.getUTCDate() !== selectedDay) continue;
    const control = area.locator('button').nth(entry.index);
    if (await usable(control)) result.push({control, epoch, label: `${selectedDay} ${months[selectedMonth]} ${selectedYear}`});
  }
  return result.sort((a, b) => b.epoch - a.epoch);
}
function minute(label: string): number | undefined {
  const match = /^(?:[✓✔]\s*)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)(?:\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM))?$/i.exec(label);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2] || 0) > 59) return;
  return Number(match[1]) % 12 * 60 + Number(match[2] || 0) + (match[3].toUpperCase() === 'PM' ? 720 : 0);
}
async function slots(panel: Locator): Promise<{control: Locator; label: string; minute: number}[]> {
  const entries = await panel.locator('div').evaluateAll(nodes => nodes.map((node, index) => ({index, label: (node.textContent || '').trim().replace(/\s+/g, ' '), leaf: ![...node.querySelectorAll('div')].some(child => (child.textContent || '').trim().replace(/\s+/g, ' ') === (node.textContent || '').trim().replace(/\s+/g, ' '))})));
  const result: {control: Locator; label: string; minute: number}[] = [];
  for (const entry of entries) {
    const time = minute(entry.label);
    if (time === undefined || !entry.leaf) continue;
    const control = panel.locator('div').nth(entry.index);
    if (await usable(control)) result.push({control, label: entry.label.replace(/^[✓✔]\s*/, ''), minute: time});
  }
  return result.sort((a, b) => b.minute - a.minute);
}

/** Select a real viewing appointment, but leave its final confirmation untouched. */
export async function prepareNoBrokerVisit(page: Page, checkpoint: () => Promise<void>): Promise<NoBrokerVisitPreparation> {
  await checkpoint();
  selections.delete(page);
  const calendar = await calendarFor(page);
  if (!calendar) return {detected: false, ready: false, reason: ''};
  const unavailable = (reason: string): NoBrokerVisitPreparation => ({detected: true, ready: false, reason});
  if (!await schedulingHeader(page)) return unavailable('NoBroker visit scheduler is ambiguous or is a reschedule. Inspect it in Chrome.');
  if (await noBrokerVisitEvidence(page).then(evidence => evidence.length > 0)) return unavailable('A visit confirmation is already visible. No new appointment was selected.');
  if (/already have a scheduled visit/i.test(await calendar.locator('..').innerText())) return unavailable('NoBroker already has a viewing appointment. Inspect your existing visit in Chrome; no reschedule was selected.');
  const availableDates = await dates(calendar);
  const day = availableDates[0];
  if (!day) return unavailable('NoBroker has no readable available visit date. Choose an available date in Chrome.');
  const oldPanel = await calendar.locator('.visit_schedule_container').count() === 1 ? await calendar.locator('.visit_schedule_container').elementHandle() : null;
  const oldText = oldPanel ? await oldPanel.innerText() : '';
  if (!await selected(day.control)) {
    await checkpoint();
    await day.control.click();
    const loaded = await waitUntil(page, checkpoint, async () => {
      if (!await selected(day.control)) return false;
      const panel = calendar.locator('.visit_schedule_container');
      if (await panel.count() !== 1 || !await panel.isVisible()) return false;
      return !oldPanel || !await oldPanel.evaluate(node => node.isConnected) || await panel.innerText() !== oldText;
    });
    if (!loaded) return unavailable('NoBroker has not finished loading times for the latest date. Recheck in Chrome; no booking was confirmed.');
  }
  const panel = calendar.locator('.visit_schedule_container');
  if (await panel.count() !== 1 || !await panel.isVisible()) return unavailable('NoBroker visit times are still loading. Recheck in Chrome.');
  let chosen: {control: Locator; label: string; minute: number} | undefined;
  for (const category of ['evening', 'afternoon', 'morning']) {
    const button = panel.getByRole('button', {name: new RegExp('^' + category + '\\s*(?:\\(\\d+\\))?$', 'i')});
    if (await button.count() !== 1 || !await usable(button) || /\(0\)/.test(await button.innerText())) continue;
    if (!await selected(button)) {
      await checkpoint();
      await button.click();
      if (!await waitUntil(page, checkpoint, () => selected(button))) return unavailable('NoBroker time group did not finish loading. No booking was confirmed.');
    }
    chosen = (await slots(panel))[0];
    if (chosen) break;
  }
  if (!chosen) return unavailable('NoBroker has no readable available visit time on the latest available date. Inspect it in Chrome.');
  if (!await selected(chosen.control)) {
    await checkpoint();
    await chosen.control.click();
    if (!await waitUntil(page, checkpoint, () => selected(chosen!.control))) return unavailable('NoBroker did not confirm the selected visit time. No booking was submitted.');
  }
  const confirm = calendar.getByRole('button', {name: 'Confirm Booking', exact: true});
  if (await confirm.count() !== 1 || !await usable(confirm)) return unavailable('NoBroker booking confirmation is not available. Inspect Chrome before continuing.');
  const summary = `Real viewing appointment: ${day.label} at ${chosen.label}; uses your signed-in NoBroker account.`;
  selections.set(page, {url: page.url(), date: day.epoch, dayLabel: day.label, timeLabel: chosen.label, summary});
  return {detected: true, ready: true, reason: summary + ' Confirm Booking has not been clicked.', summary};
}

/** One final booking click per prepared page and slot; ambiguous outcomes never retry. */
export async function submitNoBrokerVisit(page: Page): Promise<boolean> {
  const selection = selections.get(page);
  const calendar = await calendarFor(page);
  if (!selection || selection.url !== page.url() || !calendar || !await schedulingHeader(page) || (await noBrokerVisitEvidence(page)).length || /already have a scheduled visit/i.test(await calendar.locator('..').innerText())) return false;
  const day = (await dates(calendar))[0];
  const slot = (await slots(calendar.locator('.visit_schedule_container'))).find(item => item.label === selection.timeLabel);
  if (!day || day.epoch !== selection.date || !slot || !await selected(day.control) || !await selected(slot.control)) return false;
  const confirm = calendar.getByRole('button', {name: 'Confirm Booking', exact: true});
  if (await confirm.count() !== 1 || !await usable(confirm)) return false;
  const key = selection.url + '\n' + selection.summary;
  const sent = attempted.get(page) ?? new Set<string>();
  if (sent.has(key)) return false;
  sent.add(key); attempted.set(page, sent);
  await confirm.click();
  return true;
}

/** Only the portal's visible scheduled-visit confirmation is evidence. */
export async function noBrokerVisitEvidence(page: Page): Promise<string[]> {
  return page.locator('#scheduleVisitModalConfirmation').evaluateAll(nodes => nodes.flatMap(node => {
    const rectangle = node.getBoundingClientRect();
    if (!rectangle.width || !rectangle.height || getComputedStyle(node).visibility === 'hidden') return [];
    const text = (node as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
    return /\byour visit is scheduled\b/i.test(text) && text.length < 1500 ? ['nobroker-visit:' + text] : [];
  }));
}
