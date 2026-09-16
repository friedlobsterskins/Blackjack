'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchBrowser, ROOT } = require('./browser-smoke.cjs');

async function run() {
  const session = await launchBrowser();
  const { cdp, errors } = session;
  const saved = () => cdp.evaluate(`JSON.parse(localStorage.getItem('clubRoyaleCasino.v1'))`);
  const decision = () => cdp.waitFor(`!!document.querySelector('[data-action="stand"]:not(:disabled)') || !document.querySelector('#deal-btn').disabled`, 'decision');
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await cdp.send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
    await cdp.waitFor(`document.readyState === 'complete' && !!window.CasinoEngine`, 'load');
    await cdp.evaluate(`(() => {
      const original = CasinoEngine.createBlackjack;
      CasinoEngine.createBlackjack = bet => {
        CasinoEngine.createBlackjack = original;
        const sequence = '8S 10H 8D 7C 8H 8C 8D 3S 3H 2C 10S'.split(' ').map(token => ({rank:token.slice(0,-1),suit:token.slice(-1)}));
        return original(bet,sequence.reverse());
      };
    })()`);
    await cdp.click('#deal-btn');
    await decision();
    await cdp.click('[data-action="split"]');
    await decision();
    const active = await saved();
    assert.equal(active.balance, 9950);
    assert.equal(active.round.hands.length, 2);
    assert.equal(active.round.phase, 'player');
    await cdp.send('Page.reload');
    await cdp.waitFor(`document.readyState === 'complete' && !!document.querySelector('[data-action="stand"]')`, 'active round restored');
    assert.deepEqual({...await saved(),savedAt:active.savedAt}, active, 'Active round and balance restored without charging again');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('#dealer-hand .card-back').length`), 1);
    await cdp.click('[data-action="split"]');
    await decision();
    await cdp.click('[data-action="split"]');
    await decision();
    assert.equal((await saved()).round.hands.length, 4);
    assert.equal(await cdp.evaluate(`document.querySelector('[data-action="split"]').disabled`), true);
    for (const width of [390,768]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
      assert.equal(await cdp.evaluate(`document.documentElement.scrollWidth <= ${width}`), true, 'No horizontal overflow');
      assert.equal(await cdp.evaluate(`(() => {
        const table = document.querySelector('#table').getBoundingClientRect();
        return [...document.querySelectorAll('#player-hands .card, #player-hands .total-badge')].every(el => {
          const r = el.getBoundingClientRect(); return r.left >= table.left && r.right <= table.right && r.bottom <= table.bottom;
        });
      })()`), true, 'All split cards and totals fit on table');
      await cdp.screenshot('split-hands-' + width + '.png');
    }
    await cdp.click('[data-action="double"]');
    await decision();
    assert.equal((await saved()).balance, 9875, 'Four split bets plus one double charged exactly once');
    for (let i = 0; i < 3; i++) {
      await cdp.click('[data-action="stand"]');
      await decision();
    }
    const settled = await saved();
    assert.equal(settled.round.phase, 'settled');
    assert.equal(settled.round.wagered, 125);
    assert.equal(settled.balance, 9875 + settled.round.returned);
    assert.equal(settled.hands, 1);
    await cdp.send('Page.reload');
    await cdp.waitFor(`document.readyState === 'complete' && !document.querySelector('#deal-btn').disabled`, 'settled round restored');
    assert.deepEqual({...await saved(),savedAt:settled.savedAt}, settled, 'Settlement must not be paid again after reload');
    assert.deepEqual(errors, []);
    console.log('PASS Active split-hand recovery, four-hand mobile/tablet layout, double cost, and exactly-once settlement.');
  } finally { await session.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
