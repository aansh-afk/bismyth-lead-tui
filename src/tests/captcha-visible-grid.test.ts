import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Frame, Page} from 'playwright-core';
import {PortalBrowser, browserPath} from '../browser.js';
import {defaults} from '../model.js';
import {attemptCaptcha} from '../captcha.js';

const fast = {imageLoadMs: 500, totalMs: 15000, maxDecisions: 1, clickDelayMs: 20, settleMs: 20};

test('visible CAPTCHA capture checks required content instead of the entire dialog footer', {timeout: 120000}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-captcha-visible-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url?.startsWith('/widget')) {
      const columns = request.url.includes('44') ? 4 : 3;
      const canvas = request.url.includes('canvas');
      const instructionClipped = request.url.includes('instruction-clipped');
      const tiles = Array.from({length: columns}, (_, row) => `<tr>${Array.from({length: columns}, (_, column) => {
        const tile = row * columns + column + 1;
        const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="lightblue"/><text x="40" y="48">${tile}</text></svg>`);
        return `<td class="rc-imageselect-tile" role="button" onclick="window.clicks++"><div class="rc-image-tile-wrapper"><img src="data:image/svg+xml,${svg}" alt="Tile ${tile}"></div></td>`;
      }).join('')}</tr>`).join('');
      response.end(`<!doctype html><style>
        body{margin:0}#rc-imageselect{width:320px;min-width:240px}
        .rc-imageselect-payload{min-width:240px;margin:0 7px;padding:7px 0}
        .rc-imageselect-instructions{height:60px;margin-bottom:7px}
        .rc-imageselect-desc-wrapper{height:60px;background:lightblue}
        .rc-imageselect-challenge{position:relative;width:100%;height:306px}
        #rc-imageselect-target{width:306px;height:306px}
        table{border-collapse:separate;border-spacing:0;width:100%;height:100%}
        .rc-imageselect-table-33{margin:-2px}.rc-imageselect-table-33 td{padding:2px}
        .rc-imageselect-table-44{margin:-1px}.rc-imageselect-table-44 td{padding:1px}
        .rc-image-tile-wrapper{width:${306 / columns - (columns === 3 ? 4 : 2)}px;height:${306 / columns - (columns === 3 ? 4 : 2)}px;overflow:hidden}
        img{display:block;width:100%;height:100%}
        .rc-footer{height:80px}#recaptcha-verify-button{height:36px;margin-top:8px}
        ${instructionClipped ? '.rc-imageselect-payload{transform:translateY(-18px)}' : ''}
      </style><div id="rc-imageselect" role="dialog" aria-modal="true">
        <div class="rc-imageselect-payload">
          <div class="rc-imageselect-instructions"><div class="rc-imageselect-desc-wrapper">Select all blue squares</div></div>
          <div class="rc-imageselect-challenge"><div id="rc-imageselect-target"><table class="rc-imageselect-table-${columns}${columns}"><tbody>${tiles}</tbody></table></div></div>
          ${canvas ? '<canvas width="4" height="4"></canvas>' : ''}
        </div><div class="rc-footer"><button id="recaptcha-verify-button" onclick="window.clicks++">Verify</button></div>
      </div><script>window.clicks=0;window.scrolls=0;addEventListener('scroll',()=>window.scrolls++)</script>`);
    } else {
      const clipped = request.url?.includes('grid-clipped');
      const covered = request.url?.includes('covered');
      const widget = request.url?.includes('44') ? '/widget44' : request.url?.includes('canvas') ? '/widget-canvas' : request.url?.includes('instruction-clipped') ? '/widget-instruction-clipped' : '/widget33';
      response.end(`<!doctype html><h1>Complete the CAPTCHA</h1><div style="position:relative;width:330px">
        <iframe src="${widget}" style="width:320px;height:${clipped ? 280 : 410}px"></iframe>
        ${covered ? '<div id="cover" style="position:absolute;inset:0;background:white;opacity:.1"></div>' : ''}
      </div><textarea name="g-recaptcha-response" hidden></textarea><script>window.scrolls=0;addEventListener('scroll',()=>window.scrolls++)</script>`);
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const driver = new PortalBrowser(directory, true, async () => undefined);
  try {
    const page = await driver.start({...defaults, browserPath: await browserPath()});
    const open = async (path: string): Promise<Frame> => {
      await page.goto(base + path);
      const frame = page.frames().find(candidate => candidate.url().startsWith(base + '/widget'));
      assert.ok(frame);
      await frame.locator('.rc-imageselect-tile img').first().waitFor();
      return frame;
    };
    const assertStill = async (frame: Frame) => {
      assert.deepEqual(await frame.evaluate(() => {
        const fixture = window as unknown as {clicks: number; scrolls: number};
        return [fixture.clicks, fixture.scrolls, scrollY];
      }), [0, 0, 0]);
      assert.deepEqual(await page.evaluate(() => [(window as unknown as {scrolls: number}).scrolls, scrollY]), [0, 0]);
    };
    for (const columns of [3, 4]) await context.test(`complete ${columns} by ${columns} instructions and tiles remain capturable when the footer extends past the iframe`, async () => {
      const frame = await open(`/captcha${columns}${columns}`);
      const geometry = await frame.evaluate(() => {
        const root = document.querySelector('#rc-imageselect')!.getBoundingClientRect();
        const instruction = document.querySelector('.rc-imageselect-desc-wrapper')!.getBoundingClientRect();
        const tiles = [...document.querySelectorAll('.rc-imageselect-tile')].map(tile => tile.getBoundingClientRect());
        return {viewportHeight: innerHeight, rootBottom: root.bottom, requiredTop: instruction.top, requiredBottom: Math.max(instruction.bottom, ...tiles.map(tile => tile.bottom))};
      });
      assert.ok(geometry.rootBottom > geometry.viewportHeight, JSON.stringify(geometry));
      assert.ok(geometry.requiredTop >= 0 && geometry.requiredBottom < geometry.viewportHeight, JSON.stringify(geometry));
      const captures: {x: number; y: number; width: number; height: number}[] = [];
      const original: Page['screenshot'] = page.screenshot.bind(page);
      page.screenshot = async options => { if (options?.clip) captures.push(options.clip); return original(options); };
      let decisions = 0;
      try {
        const result = await attemptCaptcha(page, new AbortController().signal, async (image, count) => {
          decisions++; assert.equal(count, columns ** 2); assert.ok(image.length > 100);
          return {action: 'manual', tiles: []};
        }, undefined, undefined, fast);
        assert.equal(result.pending, true);
        assert.equal(decisions, 1, 'The whole visible instruction and grid must be captured despite footer overflow');
        assert.match(result.reason, /uncertain|invalid/);
        assert.equal(captures.length, 1);
        const frameBox = await page.locator('iframe').boundingBox(); assert.ok(frameBox);
        const crop = captures[0];
        assert.ok(crop.y <= frameBox.y + 2 + geometry.requiredTop + 1, 'Capture must include the top of the instruction');
        assert.ok(crop.y + crop.height >= frameBox.y + 2 + geometry.requiredBottom - 1, 'Capture must include the final row of tiles');
        assert.ok(crop.y + crop.height <= frameBox.y + 2 + geometry.viewportHeight, 'Capture must stay inside the iframe viewport');
        await assertStill(frame);
      } finally { page.screenshot = original; }
    });
    for (const [path, reason] of [
      ['/captcha-grid-clipped', /grid|tile|clipp/i],
      ['/captcha-instruction-clipped', /instruction|clipp/i],
      ['/captcha-canvas', /canvas/i],
      ['/captcha-covered', /cover|obstruct|overlap/i],
    ] as const) await context.test(`${path} reports a specific obstruction without inference, click or scroll`, async () => {
      const frame = await open(path); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { decisions++; return {action: 'manual', tiles: []}; }, undefined, undefined, fast);
      assert.equal(result.pending, true); assert.equal(decisions, 0);
      assert.match(result.reason, reason);
      assert.ok(!/not visible or uses an unsupported canvas/i.test(result.reason), 'Different rejection causes must not share the ambiguous old message');
      await assertStill(frame);
    });
  } finally { await driver.close(); server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true}); }
});
