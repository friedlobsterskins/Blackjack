/* Dependency-free Chrome smoke tests. Run with: node tests/browser-smoke.cjs */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(__dirname, 'artifacts');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function browserExecutable() {
  const choices = [process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = choices.find(candidate => candidate && fsSync.existsSync(candidate));
  if (!found) throw new Error('Chrome or Edge is required. Set CHROME_PATH to its executable.');
  return found;
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.serial = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params);
      }
    });
    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Browser connection closed.'));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CDP(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async waitFor(expression, label = expression, timeout = 15000) {
    const expires = Date.now() + timeout;
    while (Date.now() < expires) {
      if (await this.evaluate(expression)) return;
      await delay(70);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  async click(selector) {
    const location = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Missing click target: ' + ${JSON.stringify(selector)});
      if (element.disabled) throw new Error('Disabled click target: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({block: 'center', inline: 'center'});
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) throw new Error('Hidden click target');
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...location, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...location, button: 'left', clickCount: 1 });
  }

  async clickText(pattern, container = 'body') {
    const selector = await this.evaluate(`(() => {
      const regex = new RegExp(${JSON.stringify(pattern)}, 'i');
      const target = [...document.querySelector(${JSON.stringify(container)}).querySelectorAll('button')]
        .find(button => !button.disabled && button.getBoundingClientRect().width && regex.test(button.textContent));
      if (!target) throw new Error('No button matches: ' + ${JSON.stringify(pattern)});
      target.setAttribute('data-smoke-target', 'current');
      return '[data-smoke-target="current"]';
    })()`);
    await this.click(selector);
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute('data-smoke-target')`);
  }

  async setInput(selector, value) {
    await this.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input || input.disabled) throw new Error('Input unavailable: ' + ${JSON.stringify(selector)});
      input.value = ${JSON.stringify(String(value))};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  async screenshot(filename) {
    await fs.mkdir(ARTIFACTS, { recursive: true });
    await this.evaluate('window.scrollTo(0, 0)');
    await delay(150);
    const screenshot = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const output = path.join(ARTIFACTS, filename);
    await fs.writeFile(output, Buffer.from(screenshot.data, 'base64'));
    return output;
  }
}

async function launchBrowser() {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const profile = await fs.mkdtemp(path.join(temporaryRoot, 'club-royale-browser-'));
  const browser = spawn(browserExecutable(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'
  ], { windowsHide: true, stdio: process.env.BROWSER_DEBUG ? 'inherit' : 'ignore' });
  let spawnError;
  browser.on('error', error => { spawnError = error; });
  const closed = new Promise(resolve => browser.once('close', resolve));
  let cdp;
  let cleaned = false;
  async function close() {
    if (cleaned) return;
    cleaned = true;
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch { /* Closing the socket can race its response. */ }
      cdp.socket.close();
    }
    await Promise.race([closed, delay(3000)]);
    if (browser.exitCode === null) browser.kill();
    await Promise.race([closed, delay(3000)]);
    const resolvedProfile = path.resolve(profile);
    const relative = path.relative(temporaryRoot, resolvedProfile);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(resolvedProfile).startsWith('club-royale-browser-')) {
      throw new Error('Refusing to clean a browser profile outside the verified temporary directory.');
    }
    await fs.rm(resolvedProfile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
  try {
    let port;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (spawnError) throw spawnError;
      try {
        port = Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]);
        if (port) break;
      } catch { /* Chrome is still starting. */ }
      if (browser.exitCode !== null) throw new Error(`Chrome exited with code ${browser.exitCode}`);
      await delay(100);
    }
    if (!port) throw new Error('Chrome did not open its debugging port.');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find(target => target.type === 'page');
    if (!page) throw new Error('Chrome did not create a page.');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    const errors = [];
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
    cdp.on('Runtime.consoleAPICalled', event => {
      if (event.type === 'error') errors.push(event.args.map(arg => arg.value || arg.description).join(' '));
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    return { cdp, errors, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function smoke() {
  const session = await launchBrowser();
  const { cdp, errors } = session;
  const results = [];
  const pass = label => { results.push(label); console.log(`PASS ${label}`); };
  const balance = () => cdp.evaluate(`Number(document.querySelector('#balance').textContent.replace(/[^0-9.-]/g, ''))`);
  const actionAvailable = pattern => cdp.evaluate(`[...document.querySelectorAll('#game-actions button')].some(button => !button.disabled && new RegExp(${JSON.stringify(pattern)}, 'i').test(button.textContent))`);
  const settled = () => cdp.evaluate(`!document.querySelector('#deal-btn').disabled`);
  const waitDecision = () => cdp.waitFor(`!document.querySelector('#deal-btn').disabled || [...document.querySelectorAll('#game-actions button')].some(button => !button.disabled)`, 'a player decision or settled hand');

  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
    await cdp.waitFor(`document.readyState === 'complete' && !!document.querySelector('#deal-btn')`, 'the game to load');
    await delay(200);
    assert.deepEqual(errors, [], 'JavaScript must load without errors');
    assert.equal(await balance(), 10000, 'Fresh virtual bankroll');
    pass('Game loads with a fresh $10,000 wallet and no JavaScript errors');

    await cdp.setInput('#bet-input', 25);
    await cdp.click('[data-chip="5"]');
    assert.equal(await cdp.evaluate(`Number(document.querySelector('#bet-input').value)`), 25);
    await cdp.click('[data-zone="blackjack"]');
    assert.equal(await cdp.evaluate(`Number(document.querySelector('#bet-input').value)`), 30);
    await cdp.click('[data-action="bet"]');
    await cdp.click('#bet-dialog [data-adjust="up"]');
    assert.equal(await cdp.evaluate(`Number(document.querySelector('#bet-input').value)`), 35);
    await cdp.setInput('#bet-input', 25);
    await cdp.click('#bet-editor-done');
    pass('Chip buttons and wager shortcuts update the bet');

    await cdp.click('[data-open="rules"]');
    assert.equal(await cdp.evaluate(`document.querySelector('#info-dialog').open`), true);
    assert.match(await cdp.evaluate(`document.querySelector('#dialog-content').textContent`), /blackjack/i);
    await cdp.click('#dialog-close');
    pass('Table rules dialog opens and closes');

    await cdp.screenshot('desktop-blackjack.png');
    // Make insurance and a losing main wager reproducible without adding a production test hook.
    await cdp.evaluate(`(() => {
      const original = CasinoEngine.createBlackjack;
      CasinoEngine.createBlackjack = (bet, shoe) => {
        CasinoEngine.createBlackjack = original;
        const cards = shoe || CasinoEngine.makeDeck(6);
        cards.splice(-4, 4, { rank: '9', suit: 'D' }, { rank: '7', suit: 'S' },
          { rank: 'A', suit: 'C' }, { rank: '9', suit: 'H' });
        return original(bet, cards);
      };
    })()`);
    const beforeBlackjack = await balance();
    let verifiedLock = false;
    let verifiedInsurance = false;
    for (let round = 0; round < 8 && !verifiedLock; round++) {
      await cdp.click('#deal-btn');
      await delay(100);
      if (!(await settled())) {
        const tableBefore = await cdp.evaluate(`document.querySelector('#table-name').textContent`);
        await cdp.evaluate(`document.querySelector('#tab-ultimate').click()`);
        assert.equal(await cdp.evaluate(`document.querySelector('#table-name').textContent`), tableBefore, 'Active hand must block changing tables');
        assert.equal(await cdp.evaluate(`document.querySelector('#bet-input').disabled`), true);
        verifiedLock = true;
      }
      await waitDecision();
      for (let step = 0; step < 8 && !(await settled()); step++) {
        if (await actionAvailable('no thanks|decline|no insurance')) {
          await cdp.clickText('no thanks|decline|no insurance', '#game-actions');
          verifiedInsurance = true;
        }
        else if (await actionAvailable('stand')) await cdp.clickText('stand', '#game-actions');
        else throw new Error('Unexpected blackjack actions: ' + await cdp.evaluate(`document.querySelector('#game-actions').textContent`));
        await delay(100);
        await waitDecision();
      }
      await cdp.waitFor(`!document.querySelector('#deal-btn').disabled`, 'blackjack settlement');
    }
    assert.equal(verifiedLock, true, 'An active blackjack hand was tested');
    assert.equal(verifiedInsurance, true, 'Insurance can be declined when the dealer shows an ace');
    assert.equal(await balance(), beforeBlackjack - 25, 'A losing $25 blackjack hand debits exactly $25');
    assert.ok(await cdp.evaluate(`Number(document.querySelector('#session-hands').textContent)`) >= 1);
    pass('Blackjack insurance/stand/loss settles; active bets and game switching are locked');

    const persistedBalance = await balance();
    const persistedHands = await cdp.evaluate(`document.querySelector('#session-hands').textContent`);
    await cdp.send('Page.reload');
    await cdp.waitFor(`document.readyState === 'complete' && document.querySelector('#session-hands')?.textContent === ${JSON.stringify(persistedHands)}`, 'wallet reload');
    assert.equal(await balance(), persistedBalance);
    pass('Wallet and completed hands persist across reload');

    await cdp.click('#tab-ultimate');
    await cdp.waitFor(`!document.querySelector('#poker-bets').hidden`, 'Ultimate Texas Hold’em table');
    await cdp.setInput('#bet-input', 25);
    await cdp.setInput('#trips-input', 5);
    await cdp.click('#deal-btn');
    await waitDecision();
    await cdp.clickText('check', '#game-actions');
    await delay(100);
    await waitDecision();
    await cdp.clickText('check', '#game-actions');
    await delay(100);
    await waitDecision();
    await cdp.screenshot('desktop-ultimate.png');
    await cdp.clickText('1\\s*[×x]|play', '#game-actions');
    await cdp.waitFor(`!document.querySelector('#deal-btn').disabled`, 'Ultimate settlement');
    assert.ok(await cdp.evaluate(`Number(document.querySelector('#session-hands').textContent)`) >= 2);
    await cdp.screenshot('desktop-ultimate-showdown.png');
    pass('Ultimate Texas Hold’em check/check/1× Play settles with Trips');

    const refillBefore = await balance();
    await cdp.click('#bankroll-btn');
    await cdp.waitFor(`document.querySelector('#info-dialog').open`, 'free chips dialog');
    await cdp.clickText('add|refill|claim', '#dialog-content');
    await cdp.waitFor(`Number(document.querySelector('#balance').textContent.replace(/[^0-9.-]/g, '')) > ${refillBefore}`, 'free chips to be added');
    if (await cdp.evaluate(`document.querySelector('#info-dialog').open`)) await cdp.click('#dialog-close');
    await cdp.waitFor(`document.querySelector('#toast').hidden`, 'refill confirmation to clear');
    pass('Free chips refill the virtual wallet');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(250);
    assert.equal(await cdp.evaluate('document.documentElement.scrollWidth <= 390 && window.innerWidth <= 390'), true, 'Mobile Ultimate must not overflow horizontally');
    await cdp.screenshot('mobile-ultimate.png');
    await cdp.click('#tab-blackjack');
    await delay(250);
    assert.equal(await cdp.evaluate('document.documentElement.scrollWidth <= 390 && window.innerWidth <= 390'), true, 'Mobile blackjack must not overflow horizontally');
    await cdp.screenshot('mobile-blackjack.png');
    pass('Both tables fit a 390px mobile viewport');

    assert.deepEqual(errors, [], 'No JavaScript errors during play');
    await fs.writeFile(path.join(ARTIFACTS, 'browser-smoke.json'), JSON.stringify({ passed: results, errors, screenshots: ['desktop-blackjack.png', 'desktop-ultimate.png', 'desktop-ultimate-showdown.png', 'mobile-ultimate.png', 'mobile-blackjack.png'] }, null, 2));
    console.log(`Browser smoke passed (${results.length} checks). Screenshots: ${ARTIFACTS}`);
    return results;
  } catch (error) {
    try { await cdp.screenshot('failure.png'); } catch { /* Keep the original failure. */ }
    if (errors.length) console.error('Browser errors:', errors);
    throw error;
  } finally {
    await session.close();
  }
}

module.exports = { CDP, launchBrowser, smoke, ROOT, ARTIFACTS };
if (require.main === module) smoke().catch(error => { console.error(error); process.exitCode = 1; });
