import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun, defaults, project} from '../model.js';
import {renderView} from '../terminal-view.js';
import type {View} from '../terminal-view.js';

const handoff = 'The complete image grid is not visible or uses an unsupported canvas. Enlarge Chrome or complete verification there; no automatic scrolling or tile clicks. Audio automation is disabled. Complete the form in Chrome; C rechecks the current page, K skips this property, S stops the run, and Q saves progress and quits.';
const sizes = [[70, 22], [80, 24], [100, 30], [180, 40]] as const;

function fixture(width = 80, height = 24): View {
  const config = {...defaults, stateCode: 'MH', city: 'Mumbai', name: 'Fixture User', email: 'fixture@example.test', phone: '9000000000'};
  const run = createRun(config);
  run.state = 'running';
  run.projects = [{...project('99acres', 'Fixture office', 'https://www.99acres.com/fixture-npxid-1'), status: 'working'}];
  run.events = [{at: '2026-10-13T08:30:00.000Z', message: 'Opening the property form.'}];
  return {width, height, screen: 2, selected: [0, 0, 0, 0], config, run, history: [], fields: [], advanced: false, notice: '', help: false, handoff, active: true, auth: 'ChatGPT subscription connected'};
}

function renderedLines(view: View): string[] {
  return renderView(view).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\r\n');
}

function text(view: View): string {
  return renderedLines(view).map(line => line.trim()).join(' ').replace(/\s+/g, ' ');
}

function assertFits(view: View): void {
  const lines = renderedLines(view);
  assert.ok(lines.length <= view.height - 1, `${view.width}×${view.height} rendered ${lines.length} rows`);
  for (const [index, line] of lines.entries()) {
    assert.ok(Array.from(line).length <= view.width, `row ${index + 1} exceeds ${view.width} columns: ${line}`);
  }
}

function assertHandoffControls(view: View): void {
  const screen = text(view);
  for (const [key, description] of [['C', '(?:Continue|Recheck)'], ['K', 'Skip'], ['S', 'Stop'], ['Q', 'Quit']] as const) {
    assert.match(screen, new RegExp(`\\b${key}\\b[^\\r\\n]{0,45}\\b${description}\\b`, 'i'), `${key} ${description} remains readable`);
  }
}

test('pending NoBroker requests remain separate from visits and interests at supported terminal sizes', () => {
  for (const [width, height] of sizes) {
    const view = {...fixture(width, height), handoff: '', active: false};
    view.run!.state = 'complete';
    view.run!.projects = [
      {...project('nobroker', 'Pending fixture', 'https://www.nobroker.in/property/pending'), status: 'submitted', contactAction: {kind: 'visit-booking', summary: 'Viewing request', visitStatus: 'pending'}},
      {...project('nobroker', 'Scheduled fixture', 'https://www.nobroker.in/property/scheduled'), status: 'submitted', contactAction: {kind: 'visit-booking', summary: 'Viewing request', visitStatus: 'scheduled'}},
      {...project('housing', 'Interest fixture', 'https://housing.com/fixture'), status: 'submitted', contactAction: {kind: 'interest', summary: 'Callback details shared'}},
    ];
    assertFits(view);
    assert.match(text(view), /1 interests · 0 messages · 1 visits/);
    assert.match(text(view), /1 visit requests awaiting NoBroker confirmation/);
    assert.doesNotMatch(text(view), /CHROME NEEDS YOU|Complete any OTP/);
    const history = {...view, screen: 3, history: [view.run!]};
    assertFits(history);
    assert.match(text(history), /3 submitted/);
    assert.doesNotMatch(text(history), /3 confirmed/);
  }
});

test('Chrome handoff wraps its reason and keeps the full message accessible in compact and sidebar terminals', () => {
  for (const [width, height] of sizes) {
    const view = fixture(width, height);
    assertFits(view);
    assertHandoffControls(view);
    assert.match(text(view), /CHROME NEEDS YOU/);
    assert.match(text(view), /complete image grid/);
    const details = {...view, details: {offset: 0}};
    assertFits(details);
    assert.match(text(details), /Audio automation is disabled\./);
    assert.match(text(details), /Q saves progress and quits\./, 'the previously truncated end of the supplied reason is readable');
  }
});

test('long reasons advertise full-message access while preserving all run controls', () => {
  const message = handoff + ' ' + Array.from({length: 180}, (_, index) => `context${String(index).padStart(3, '0')}`).join(' ') + ' END-OF-DIAGNOSTIC';
  for (const [width, height] of sizes) {
    const view = {...fixture(width, height), handoff: message};
    assertFits(view);
    assertHandoffControls(view);
    assert.match(text(view), /\bE\b[^\r\n]{0,35}(?:full|message)|(?:full|message)[^\r\n]{0,35}\bE\b/i, 'overflow exposes the E full-message shortcut');
  }
});

test('scrolling message details exposes every section of a long diagnostic within the terminal budget', () => {
  const sections = Array.from({length: 160}, (_, index) => `section${String(index).padStart(3, '0')} café résumé`);
  const message = 'BEGIN-DIAGNOSTIC ' + sections.join(' ') + ' END-DIAGNOSTIC';
  for (const [width, height] of sizes) {
    const pages: string[] = [];
    for (let offset = 0; offset < 100; offset += 5) {
      const view = {...fixture(width, height), handoff: message, details: {offset}};
      assertFits(view);
      pages.push(text(view));
    }
    const accessible = pages.join(' ');
    assert.match(accessible, /BEGIN-DIAGNOSTIC/);
    assert.match(accessible, /END-DIAGNOSTIC/);
    for (const section of sections) assert.ok(accessible.includes(section), `${width}×${height} exposes ${section}`);
    const atEnd = {...fixture(width, height), handoff: message, details: {offset: 100000}};
    assertFits(atEnd);
    assert.match(text(atEnd), /END-DIAGNOSTIC/, 'overscrolling clamps to the end of the message');
    assert.match(text(atEnd), /Esc|Close|Back/i, 'message details retain a visible return control');
  }
});

test('unbroken URLs and Unicode text wrap without overflowing or losing the diagnostic', () => {
  const url = 'https://example.test/diagnostic/' + 'abcdef0123456789'.repeat(20) + '?phase=complete';
  const message = 'café naïve résumé ' + url + ' END-OF-URL';
  for (const [width, height] of sizes) {
    const view = {...fixture(width, height), handoff: message, details: {offset: 0}};
    assertFits(view);
    const joined = renderedLines(view).map(line => line.trim()).join('');
    assert.ok(joined.includes(url), `${width}×${height} retains the entire wrapped URL`);
    assert.match(text(view), /café naïve résumé/);
    assert.match(text(view), /END-OF-URL/);
    assertFits({...view, details: undefined});
  }
});

test('untrusted message controls and newlines cannot clear the screen or inject terminal rows', () => {
  const message = 'BEGIN-SAFE\x1b[2J clear-screen\x1b]52;c;clipboard\x07\nline-two\rline-three\x00\u202eEND-SAFE';
  for (const [width, height] of sizes) {
    for (const details of [undefined, {offset: 0}]) {
      const view = {...fixture(width, height), handoff: message, details};
      const rendered = renderView(view);
      assertFits(view);
      assert.ok(!rendered.includes('\x1b[2J'), 'untrusted clear-screen escape is inert');
      assert.ok(!rendered.includes('\x1b]'), 'untrusted OSC escape is inert');
      assert.doesNotMatch(rendered, /[\x00\x07\u202e]/);
      assert.ok(!rendered.replace(/\r\n/g, '').includes('\n'), 'untrusted newline cannot create an extra terminal row');
      assert.match(text(view), /BEGIN-SAFE/);
      assert.match(text(view), /line-two line-three/);
      assert.match(text(view), /END-SAFE/);
    }
  }
});

test('short notices retain their workflow context after the message footer grows', () => {
  for (const [width, height] of sizes) {
    const view = {...fixture(width, height), handoff: '', notice: 'Profile saved. Ready to review the queue.', active: false};
    assertFits(view);
    assert.match(text(view), /Profile saved\. Ready to review the queue\./);
    assert.match(text(view), /Enter \/ Ctrl\+R Review queue/);
    assert.match(text(view), /Q Quit/);
  }
});
