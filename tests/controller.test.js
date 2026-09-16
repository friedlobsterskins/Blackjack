'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../game-engine.js');
const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const STORAGE_KEY = 'clubRoyaleCasino.v1';

function cards(text) {
  return text.split(/\s+/).map(card => ({ rank: card.slice(0, -1), suit: card.slice(-1) }));
}
function shoe(text) { return cards(text).reverse(); }
function savedRound(round) {
  return {
    version: 1, savedAt: Date.now(), balance: 10000 - round.wagered, game: round.game,
    bets: { blackjack: 25, ultimate: 25, trips: round.trips || 0 }, net: 0,
    hands: 0, history: [], shoe: round.shoe || [], round, sound: false
  };
}
function pokerRound() {
  // Player's eventual royal flush must not be disclosed before the flop.
  return E.createUltimate(25, 5, shoe('AS 2D KS 3C QS JS 10S 7H 6C'));
}

// This deliberately small DOM adapter exercises the real event handlers and
// localStorage writes. Rendering/layout has separate real-browser smoke tests.
function browser(saved, engine = E) {
  const nodes = new Map();
  const listeners = new Map();
  const timers = new Map();
  const storage = new Map(saved ? [[STORAGE_KEY, JSON.stringify(saved)]] : []);
  let timerSerial = 0;
  let document;
  class Element {
    constructor(id = '') {
      this.id = id;
      this.dataset = {};
      this.tagName = 'DIV';
      this.value = '';
      this.innerHTML = '';
      this.textContent = '';
      this.disabled = false;
      this.hidden = false;
      this.open = false;
      this.events = new Map();
      this.attributes = new Map();
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, callback) {
      if (!this.events.has(name)) this.events.set(name, []);
      this.events.get(name).push(callback);
    }
    querySelector(selector) { return ['.felt-brand-name','.felt-payout'].includes(selector) ? node(selector.slice(1)) : null; }
    closest(selector) { return selector === 'button' && this.tagName === 'BUTTON' ? this : null; }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, new Element(id));
    return nodes.get(id);
  }
  const gameButtons = ['blackjack', 'ultimate'].map(game => {
    const element = node('tab-' + game);
    element.tagName = 'BUTTON';
    element.dataset.game = game;
    return element;
  });
  for (const id of ['bet-input', 'trips-input']) node(id).tagName = 'INPUT';
  document = {
    activeElement: { tagName: 'BODY', dataset: {} },
    getElementById: node,
    querySelector: selector => selector === '.betting-panel' ? node('betting-panel') : null,
    querySelectorAll: selector => selector === '[data-game]' ? gameButtons : selector.includes('#bet-input') ? [node('bet-input'), node('trips-input')] : [],
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    }
  };
  const context = vm.createContext({
    document, window: { CasinoEngine: engine, matchMedia: () => ({ matches: true }), innerWidth: 1200 },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    setTimeout: (callback, ms) => { const id = ++timerSerial; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id), console
  });
  vm.runInContext(controllerSource, context, { filename: 'script.js' });
  return {
    node,
    state: () => JSON.parse(storage.get(STORAGE_KEY)),
    click(dataset) {
      const target = new Element();
      target.tagName = 'BUTTON';
      target.dataset = dataset;
      for (const callback of listeners.get('click') || []) callback({ target });
    },
    key(key, focusedTag = 'BODY') {
      document.activeElement = { tagName: focusedTag, dataset: {} };
      for (const callback of listeners.get('keydown') || []) callback({ key, preventDefault() {} });
    },
    async flush() {
      for (let iteration = 0; iteration < 100; iteration++) {
        await new Promise(resolve => setImmediate(resolve));
        const next = [...timers].find(([, timer]) => timer.ms < 1000);
        if (!next) return;
        timers.delete(next[0]);
        next[1].callback();
      }
      throw new Error('Animation did not complete.');
    }
  };
}

test('reload resumes active blackjack without charging again or exposing hole card', () => {
  const round = E.createBlackjack(25, shoe('10S 9H 8D KC'));
  const app = browser(savedRound(round));
  assert.equal(app.state().balance, 9975);
  assert.equal(app.state().round.phase, 'player');
  assert.equal(app.state().hands, 0);
  assert.match(app.node('dealer-hand').innerHTML, /9 of hearts/);
  assert.match(app.node('dealer-hand').innerHTML, /Face-down card/);
  assert.doesNotMatch(app.node('dealer-hand').innerHTML, /K of clubs/);
  assert.equal(app.node('dealer-total').textContent, '9');
  assert.equal(app.node('bet-input').disabled, true);
  assert.equal(app.node('tab-ultimate').disabled, true);
});

test('refresh expires stale sessions after thirty minutes and retains the chosen starting bankroll', () => {
  const saved = savedRound(pokerRound());
  saved.startingAmount = 1000;
  saved.savedAt = Date.now()-30*60*1000;
  const reset = browser(saved).state();
  assert.equal(reset.balance,1000);
  assert.equal(reset.game,'blackjack');
  assert.equal(reset.round,null);
  assert.equal(reset.hands,0);
  assert.deepEqual(reset.bets,{blackjack:25,ultimate:25,trips:0});
  saved.savedAt = Date.now()-29*60*1000;
  assert.equal(browser(saved).state().round.phase,'preflop');
});

test('manual Play chips survive reload, validate the multiplier, and debit once on confirmation', async () => {
  const app = browser(savedRound(pokerRound()));
  assert.doesNotMatch(app.node('game-actions').innerHTML,/data-action="play3"/);
  const balance = app.state().balance;
  app.click({zone:'play'});
  app.click({action:'confirm-play'});
  assert.equal(app.state().round.phase,'preflop');
  app.click({zone:'play'});
  assert.equal(app.state().balance,balance);
  const restored = browser(app.state());
  assert.deepEqual(restored.state().round.draftChips,[25,25]);
  restored.click({zone:'play'});
  restored.click({action:'confirm-play'});
  await restored.flush();
  assert.equal(restored.state().round.play,75);
  assert.deepEqual(restored.state().round.chips.play,[25,25,25]);
  assert.equal(restored.state().hands,1);
});

test('chips keep their denominations when added, removed, and undone', () => {
  const app = browser();
  for (let i=0;i<5;i++) app.click({zone:'blackjack'});
  assert.deepEqual(app.state().chips.blackjack,[25,25,25,25,25,25]);
  assert.match(app.node('betting-spots').innerHTML,/data-chip-count="6"/);
  app.click({action:'remove-chip'});
  app.click({zone:'blackjack'});
  assert.equal(app.state().bets.blackjack,125);
  app.click({action:'undo'});
  assert.equal(app.state().bets.blackjack,150);
  assert.equal(app.state().chips.blackjack.length,6);
});

test('bankroll resets accept custom starting amounts and clear session history', () => {
  const app = browser();
  app.node('starting-amount').value = '1000';
  app.click({action:'reset-bankroll'});
  assert.equal(app.state().balance,1000);
  assert.equal(app.state().startingAmount,1000);
  assert.equal(app.state().net,0);
  app.node('starting-amount').value = '-5';
  app.click({action:'reset-bankroll'});
  assert.equal(app.state().balance,1000);
});

test('reload settles an unpaid terminal round once, then preserves paid balance and history', () => {
  const round = E.createBlackjack(25, shoe('10S 10H 8D 7C'));
  E.actBlackjack(round, 'stand');
  const first = browser(savedRound(round)).state();
  assert.equal(first.balance, 10025);
  assert.equal(first.net, 25);
  assert.equal(first.hands, 1);
  assert.equal(first.history.length, 1);
  assert.equal(first.round.paid, true);
  const second = browser(first).state();
  assert.deepEqual({...second,savedAt:first.savedAt}, first);
});

test('natural payout is persisted atomically but appears only after the dealer reveal', async () => {
  const engine = { ...E, makeDeck: () => [...E.makeDeck(6), ...shoe('AS 9H KC 7D')] };
  const app = browser(undefined, engine);
  app.click({ action: 'deal' });
  assert.equal(app.state().balance, 10037.5);
  assert.equal(app.state().round.paid, true);
  assert.equal(app.state().net, 37.5);
  assert.equal(app.node('balance').textContent, '$9,975.00');
  assert.equal(app.node('session-hands').textContent, '0');
  assert.doesNotMatch(app.node('recent-hands').innerHTML, /37\.50|history-row/);
  const duringAnimation = app.state();
  await app.flush();
  assert.equal(app.node('balance').textContent, '$10,037.50');
  assert.equal(app.node('session-hands').textContent, '1');
  assert.match(app.node('recent-hands').innerHTML, /37\.50/);
  assert.equal(browser(duringAnimation).state().balance, 10037.5);
});

test('double debits exactly once and repeated clicks during animation are ignored', async () => {
  const round = E.createBlackjack(25, shoe('5S 10H 6D 7C KS'));
  const app = browser(savedRound(round));
  app.click({ action: 'double' });
  const saved = app.state();
  assert.equal(saved.balance, 10050);
  assert.equal(saved.round.wagered, 50);
  assert.equal(saved.round.returned, 100);
  assert.equal(saved.net, 50);
  assert.equal(saved.hands, 1);
  app.click({ action: 'double' });
  app.click({ action: 'deal' });
  assert.deepEqual(app.state(), saved);
  await app.flush();
  assert.equal(app.node('balance').textContent, '$10,050.00');
});

test('insurance and split costs stay charged across active-round reload', async () => {
  const insured = E.createBlackjack(25, shoe('8S AH 8D 6C 2S 3D 10C'));
  let app = browser(savedRound(insured));
  app.click({ action: 'insurance' });
  assert.equal(app.state().balance, 9962.5);
  assert.equal(app.state().round.phase, 'player');
  await app.flush();
  app = browser(app.state());
  assert.equal(app.state().balance, 9962.5);
  app.click({ action: 'split' });
  assert.equal(app.state().balance, 9937.5);
  assert.equal(app.state().round.hands.length, 2);
  assert.equal(app.state().round.wagered, 62.5);
  await app.flush();
  const resumed = browser(app.state()).state();
  assert.equal(resumed.balance, 9937.5);
  assert.equal(resumed.round.hands.length, 2);
  assert.equal(resumed.round.shoe.length, resumed.shoe.length);
});

test('Ultimate exposes only the current street and never puts hidden dealer faces in the DOM', async () => {
  let app = browser(savedRound(pokerRound()));
  assert.equal((app.node('community-hand').innerHTML.match(/card-placeholder/g) || []).length, 5);
  assert.equal((app.node('dealer-hand').innerHTML.match(/Face-down card/g) || []).length, 2);
  assert.doesNotMatch(app.node('dealer-hand').innerHTML, /2 of diamonds|3 of clubs/);
  assert.doesNotMatch(app.node('player-hands').innerHTML, /Royal Flush/);
  app.click({ action: 'check' });
  await app.flush();
  assert.equal(app.state().round.phase, 'flop');
  assert.equal((app.node('community-hand').innerHTML.match(/card-placeholder/g) || []).length, 2);
  assert.doesNotMatch(app.node('community-hand').innerHTML, /7 of hearts|6 of clubs/);
  app = browser(app.state());
  assert.equal((app.node('community-hand').innerHTML.match(/card-placeholder/g) || []).length, 2);
  app.click({ action: 'check' });
  await app.flush();
  assert.equal(app.state().round.phase, 'river');
  assert.match(app.node('community-hand').innerHTML, /7 of hearts/);
  assert.match(app.node('community-hand').innerHTML, /6 of clubs/);
  assert.equal((app.node('dealer-hand').innerHTML.match(/Face-down card/g) || []).length, 2);
});

test('early Ultimate showdown hides pending results in wallet, session, and history dialog', async () => {
  const app = browser(savedRound(pokerRound()));
  app.click({ action: 'play4' });
  const persisted = app.state();
  assert.equal(persisted.round.phase, 'settled');
  assert.equal(persisted.round.paid, true);
  assert.equal(persisted.round.playerRank.name, 'Royal Flush');
  assert.equal(app.node('balance').textContent, '$9,845.00');
  assert.equal(app.node('session-net').textContent, '$0.00');
  assert.equal(app.node('session-hands').textContent, '0');
  assert.doesNotMatch(app.node('recent-hands').innerHTML, /Royal Flush/);
  assert.doesNotMatch(app.node('community-hand').innerHTML, /Q of spades|J of spades|10 of spades/);
  app.click({ open: 'history' });
  assert.match(app.node('dialog-content').innerHTML, /0 hands played/);
  assert.doesNotMatch(app.node('dialog-content').innerHTML, /Royal Flush/);
  await app.flush();
  assert.equal(app.node('session-hands').textContent, '1');
  assert.match(app.node('recent-hands').innerHTML, /Royal Flush/);
  assert.match(app.node('dealer-hand').innerHTML, /2 of diamonds/);
  assert.match(app.node('dealer-hand').innerHTML, /3 of clubs/);
  const reload = browser(persisted).state();
  assert.equal(reload.balance, persisted.balance);
  assert.equal(reload.hands, 1);
  assert.equal(reload.history.length, 1);
});

test('free-chip refills leave session profit intact and are rejected midhand', () => {
  const idle = browser();
  idle.click({ action: 'refill' });
  assert.equal(idle.state().balance, 20000);
  assert.equal(idle.state().net, 0);
  const app = browser(savedRound(pokerRound()));
  const before = app.state();
  app.click({ action: 'refill' });
  app.click({ game: 'blackjack' });
  assert.deepEqual(app.state(), before);
});

test('keyboard shortcuts work with action-button focus and ignore editable inputs', async () => {
  const round = E.createBlackjack(25, shoe('10S 10H 8D 7C'));
  const app = browser(savedRound(round));
  app.key('s', 'INPUT');
  assert.equal(app.state().round.phase, 'player');
  app.key('s', 'BUTTON');
  assert.equal(app.state().round.phase, 'settled');
  await app.flush();
  assert.equal(app.state().balance, 10025);
});

test('Ultimate keyboard decisions respect the current street and open guides', async () => {
  const app = browser(savedRound(pokerRound()));
  const opening = app.state();
  app.click({open:'guide'});
  app.key('4','BUTTON');
  assert.deepEqual(app.state(),opening,'A guide prevents a hidden keyboard wager');
  app.node('info-dialog').close();
  app.key('c','BUTTON');
  await app.flush();
  assert.equal(app.state().round.phase,'flop');
  app.key('c','BUTTON');
  await app.flush();
  assert.equal(app.state().round.phase,'river');
  const river = app.state();
  app.key('4','BUTTON');
  assert.deepEqual(app.state(),river,'An unavailable play multiple never charges the wallet');
  app.key('1','INPUT');
  assert.deepEqual(app.state(),river,'Editing a number cannot make a play');
  app.key('1','BUTTON');
  assert.equal(app.node('table-result').hidden,true,'A pending result stays hidden until the reveal');
  await app.flush();
  const final = app.state();
  assert.equal(final.round.phase,'settled');
  assert.equal(final.round.play,25);
  assert.equal(final.round.wagered,80);
  assert.equal(final.balance,10000-80+final.round.returned);
  assert.equal(app.node('table-result').hidden,false);
});

test('chip selection does not wager until a circle is clicked; clear and undo preserve the wallet', () => {
  const app = browser();
  app.click({chip:'5'});
  assert.equal(app.state().bets.blackjack,25);
  app.click({zone:'blackjack'});
  assert.equal(app.state().bets.blackjack,30);
  assert.equal(app.state().balance,10000);
  app.click({action:'clear'});
  assert.equal(app.state().bets.blackjack,0);
  app.click({action:'undo'});
  assert.equal(app.state().bets.blackjack,30);
  assert.match(app.node('betting-spots').innerHTML,/table-chip/);
});

test('Ultimate circles match Ante and Blind, keep Trips separate, and enforce table limits', () => {
  const app = browser();
  app.click({game:'ultimate'});
  app.click({chip:'25'});
  app.click({zone:'blind'});
  assert.equal(app.state().bets.ultimate,50);
  app.click({chip:'5'});
  app.click({zone:'trips'});
  assert.equal(app.state().bets.trips,5);
  assert.equal(app.state().bets.ultimate,50);
  assert.equal(app.state().balance,10000);
  app.click({chip:'500'});
  app.click({zone:'ante'});
  assert.equal(app.state().bets.ultimate,550);
  app.click({zone:'ante'});
  app.click({zone:'ante'});
  app.click({zone:'ante'});
  assert.equal(app.state().bets.ultimate,1550);
  assert.match(app.node('toast').textContent,/limit/);
  assert.match(app.node('betting-spots').innerHTML,/data-zone="play"/);
});

test('main tables enforce a $25 minimum and accept the full $2,000 opening limit', async () => {
  for (const game of ['blackjack','ultimate']) {
    const app = browser();
    app.click({game});
    for (const amount of [5,20,2005]) {
      app.node('bet-input').value = String(amount);
      app.click({action:'deal'});
      assert.equal(app.state().round,null);
      assert.equal(app.state().balance,10000);
      assert.match(app.node('toast').textContent,/\$25.*\$2,000/);
    }
    app.node('bet-input').value = '2000';
    app.click({action:'deal'});
    assert.equal(app.state().round.initialBet || app.state().round.ante,2000);
    assert.match(app.node('player-hands').innerHTML,/hand/);
    await app.flush();
    if (game === 'ultimate') {
      assert.match(app.node('player-hands').innerHTML,/hole-cards/);
      assert.equal((app.node('player-hands').innerHTML.match(/--fan-angle:/g) || []).length,2);
      assert.match(app.node('player-hands').innerHTML,/--fan-angle:-9deg/);
      assert.match(app.node('player-hands').innerHTML,/--fan-angle:9deg/);
    } else {
      assert.match(app.node('player-hands').innerHTML,/blackjack-hand/);
      assert.doesNotMatch(app.node('player-hands').innerHTML,/--fan-angle:/);
      assert.match(app.node('player-hands').innerHTML,/--card-index:0/);
      assert.match(app.node('player-hands').innerHTML,/--card-index:1/);
    }
    assert.doesNotMatch(app.node('dealer-hand').innerHTML,/--fan-angle:/);
    assert.doesNotMatch(app.node('community-hand').innerHTML,/--fan-angle:/);
  }
});
