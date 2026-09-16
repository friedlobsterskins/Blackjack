'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../game-engine.js');

function cards(text) {
  return text.trim().split(/\s+/).filter(Boolean).map(card => ({ rank: card.slice(0, -1), suit: card.slice(-1) }));
}
function shoe(text) { return cards(text).reverse(); }
function bj(text, bet = 10) { return E.createBlackjack(bet, shoe(text)); }
function poker(text) { return E.evaluatePoker(cards(text)); }
function ultimate(player, dealer, board, ante = 10, trips = 0) {
  const p = cards(player);
  const d = cards(dealer);
  return E.createUltimate(ante, trips, [p[0], d[0], p[1], d[1], ...cards(board)].reverse());
}
function playRiver(round) {
  E.actUltimate(round, 'check', 1000);
  E.actUltimate(round, 'check', 1000);
  E.actUltimate(round, 'play1', 1000);
  return round;
}
function part(round, label) { return round.breakdown.find(item => item.label === label); }

test('shuffled shoes preserve every card in one through eight decks', () => {
  for (const count of [1, 6, 8]) {
    const deck = E.makeDeck(count);
    assert.equal(deck.length, count * 52);
    const counts = new Map();
    for (const card of deck) {
      assert.match(card.rank, /^(?:[2-9]|10|J|Q|K|A)$/);
      assert.match(card.suit, /^[SHDC]$/);
      const key = card.rank + card.suit;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    assert.equal(counts.size, 52);
    assert.ok([...counts.values()].every(value => value === count));
  }
  assert.throws(() => E.makeDeck(0));
  assert.throws(() => E.makeDeck(1.5));
});

test('blackjack counts flexible aces and identifies only two-card naturals', () => {
  assert.deepEqual(E.blackjackValue(cards('AS AH 5C')), { total: 17, soft: true });
  assert.deepEqual(E.blackjackValue(cards('AS 6H KC')), { total: 17, soft: false });
  assert.deepEqual(E.blackjackValue(cards('AS AH 9C')), { total: 21, soft: true });
  assert.deepEqual(E.blackjackValue(cards('AS AH KC 9D')), { total: 21, soft: false });
  assert.equal(E.isBlackjack(cards('AS KH')), true);
  assert.equal(E.isBlackjack(cards('7S 7H 7C')), false);
});

test('natural pays 3:2, includes stake, and does not draw dealer cards', () => {
  const round = bj('AS 9C KH 7D 2C');
  assert.equal(round.phase, 'settled');
  assert.equal(round.hands[0].result, 'blackjack');
  assert.equal(round.returned, 25);
  assert.equal(round.wagered, 10);
  assert.equal(round.dealer.length, 2);
  assert.equal(round.shoe.length, 1);
  assert.deepEqual(E.blackjackActions(round, 100), []);
  assert.throws(() => E.actBlackjack(round, 'hit', 100));
});

test('American ten-upcard peek settles dealer blackjack before player actions', () => {
  const round = bj('9H KS 8C AH 2C');
  assert.equal(round.phase, 'settled');
  assert.equal(round.dealerBlackjack, true);
  assert.equal(round.hands[0].result, 'lose');
  assert.equal(round.returned, 0);
  assert.equal(round.shoe.length, 1);
});

test('insurance costs half the original wager and pays 2:1 on dealer blackjack', () => {
  const round = bj('10S AH 9D KC');
  assert.equal(round.phase, 'insurance');
  assert.deepEqual(E.blackjackActions(round, 4), ['decline']);
  const before = JSON.stringify(round);
  assert.throws(() => E.actBlackjack(round, 'insurance', 4));
  assert.equal(JSON.stringify(round), before);
  assert.deepEqual(E.actBlackjack(round, 'insurance', 5), { cost: 5, settled: true });
  assert.equal(round.insurance.returned, 15);
  assert.equal(round.wagered, 15);
  assert.equal(round.returned, 15);
  assert.equal(round.result, 'push');
});

test('both naturals push and a player natural can buy insurance', () => {
  const push = bj('AS AH KC KD');
  E.actBlackjack(push, 'decline', 0);
  assert.equal(push.hands[0].result, 'push');
  assert.equal(push.returned, 10);
  const insured = bj('AS AH KC 9D');
  E.actBlackjack(insured, 'insurance', 5);
  assert.equal(insured.hands[0].result, 'blackjack');
  assert.equal(insured.insurance.result, 'lose');
  assert.equal(insured.returned, 25);
  assert.equal(insured.wagered, 15);
});

test('dealer hits soft 17 and stands on hard 17', () => {
  const soft = bj('10S AH 8D 6C KS');
  E.actBlackjack(soft, 'decline', 100);
  E.actBlackjack(soft, 'stand', 100);
  assert.equal(soft.dealer.length, 3);
  assert.equal(soft.returned, 20);
  const hard = bj('10S 10H 8D 7C KS');
  E.actBlackjack(hard, 'stand', 100);
  assert.equal(hard.dealer.length, 2);
  assert.equal(hard.shoe.length, 1);
  assert.equal(hard.returned, 20);
});

test('a player bust loses immediately without drawing dealer cards', () => {
  const round = bj('10S 6H 8D 10C KS 2H');
  E.actBlackjack(round, 'hit', 0);
  assert.equal(round.phase, 'settled');
  assert.equal(round.hands[0].result, 'bust');
  assert.equal(round.returned, 0);
  assert.equal(round.dealer.length, 2);
  assert.equal(round.shoe.length, 1);
});

test('dealer bust pays all surviving hands, equal totals push, higher dealer wins', () => {
  const bust = bj('10S 6H 8D 10C KS');
  E.actBlackjack(bust, 'stand');
  assert.equal(bust.returned, 20);
  const push = bj('10S 10H 8D 8C');
  E.actBlackjack(push, 'stand');
  assert.equal(push.hands[0].result, 'push');
  assert.equal(push.returned, 10);
  const loss = bj('10S 10H 8D 9C');
  E.actBlackjack(loss, 'stand');
  assert.equal(loss.returned, 0);
});

test('double costs one additional wager, draws exactly once, and ends the hand', () => {
  const round = bj('5S 10H 6D 7C KS 2H');
  assert.ok(!E.blackjackActions(round, 9).includes('double'));
  const before = JSON.stringify(round);
  assert.throws(() => E.actBlackjack(round, 'double', 9));
  assert.equal(JSON.stringify(round), before);
  assert.deepEqual(E.actBlackjack(round, 'double', 10), { cost: 10, settled: true });
  assert.equal(round.hands[0].doubled, true);
  assert.equal(round.hands[0].cards.length, 3);
  assert.equal(round.hands[0].bet, 20);
  assert.equal(round.wagered, 20);
  assert.equal(round.returned, 40);
  assert.equal(round.shoe.length, 1);
});

test('no doubling or splitting after a hit, no surrender, and no illegal phase actions', () => {
  const round = bj('2S 10H 2D 7C 3S 9C');
  E.actBlackjack(round, 'hit');
  assert.deepEqual(E.blackjackActions(round, 100), ['hit', 'stand']);
  for (const action of ['double', 'split', 'surrender', 'insurance', 'decline', 'unknown']) {
    const before = JSON.stringify(round);
    assert.throws(() => E.actBlackjack(round, action, 100));
    assert.equal(JSON.stringify(round), before);
  }
});

test('splitting allows double after split and settles each stake separately', () => {
  const round = bj('8S 6H 8D 10C 3C KS 2C 9H 10D');
  assert.deepEqual(E.actBlackjack(round, 'split', 100), { cost: 10, settled: false });
  assert.equal(round.hands.length, 2);
  assert.equal(round.activeHand, 0);
  assert.deepEqual(round.hands[0].cards, cards('8S 3C'));
  assert.deepEqual(round.hands[1].cards, cards('8D'), 'Next hand waits until the first hand is played');
  assert.equal(E.actBlackjack(round, 'double', 100).cost, 10);
  assert.deepEqual(round.hands[0].cards, cards('8S 3C KS'));
  assert.deepEqual(round.hands[1].cards, cards('8D 2C'));
  assert.equal(round.activeHand, 1);
  E.actBlackjack(round, 'double', 100);
  assert.equal(round.wagered, 40);
  assert.equal(round.returned, 80);
  assert.ok(round.hands.every(hand => hand.fromSplit && hand.doubled && hand.result === 'win'));
});

test('house qualification uses exposed cards and replaces the lower board pair as hole cards appear', () => {
  assert.equal(E.visiblePokerHand(cards('2S KH')).category, 0);
  assert.deepEqual(E.visiblePokerHand(cards('2S 2H')).cards, cards('2S 2H'));
  assert.deepEqual(E.visiblePokerHand(cards('2S 2H 9D 9C AS')).cards, cards('2S 2H 9D 9C'));
  assert.deepEqual(E.visiblePokerHand(cards('2S 2H 9D 9C AS QD')).cards, cards('2S 2H 9D 9C'));
  assert.deepEqual(E.visiblePokerHand(cards('2S 2H 9D 9C AS QD QC')).cards, cards('9D 9C QD QC'));
});

test('split aces receive exactly one card each, cannot resplit, and 21 pays even money', () => {
  const round = bj('AS 9H AD 8C KS AC');
  E.actBlackjack(round, 'split', 100);
  assert.equal(round.phase, 'settled');
  assert.ok(round.hands.every(hand => hand.splitAces && hand.done && hand.cards.length === 2));
  assert.equal(round.hands[0].result, 'win');
  assert.equal(round.hands[0].returned, 20);
  assert.equal(round.hands[1].returned, 0);
  assert.equal(round.returned, 20);
  assert.equal(round.wagered, 20);
});

test('mixed ten-value cards can split; nonpairs and unaffordable pairs cannot', () => {
  const mixed = bj('KS 10H QD 7C 2S 3D');
  assert.ok(E.blackjackActions(mixed, 10).includes('split'));
  assert.ok(!E.blackjackActions(mixed, 9).includes('split'));
  const nonpair = bj('8S 10H 7D 7C');
  assert.ok(!E.blackjackActions(nonpair, 100).includes('split'));
});

test('resplitting stops at four hands', () => {
  const round = bj('8S 10H 8D 7C 8C 8H 8D 2D 3D 4D');
  E.actBlackjack(round, 'split', 100);
  E.actBlackjack(round, 'split', 100);
  E.actBlackjack(round, 'split', 100);
  assert.equal(round.hands.length, 4);
  assert.equal(round.wagered, 40);
  E.actBlackjack(round, 'stand');
  E.actBlackjack(round, 'stand');
  E.actBlackjack(round, 'stand');
  assert.equal(round.activeHand, 3);
  assert.deepEqual(round.hands[3].cards.map(card => card.rank), ['8', '4']);
  assert.ok(!E.blackjackActions(round, 100).includes('split'));
  E.actBlackjack(round, 'stand');
  assert.equal(round.phase, 'settled');
});

test('rounds and shared shoes survive JSON serialization', () => {
  const supplied = shoe('5S 10H 6D 7C KS');
  const original = E.createBlackjack(10, supplied);
  assert.equal(original.shoe, supplied);
  assert.equal(supplied.length, 1);
  const restored = JSON.parse(JSON.stringify(original));
  E.actBlackjack(restored, 'double', 10);
  assert.equal(restored.returned, 40);
  assert.equal(restored.phase, 'settled');
});

test('poker correctly identifies all categories and ace-low straights', () => {
  const examples = [
    ['AS JD 9C 6H 2S', 0, [14, 11, 9, 6, 2]],
    ['AS AD 9C 6H 2S', 1, [14, 9, 6, 2]],
    ['AS AD 9C 9H 2S', 2, [14, 9, 2]],
    ['AS AD AC 6H 2S', 3, [14, 6, 2]],
    ['AS 2D 3C 4H 5S', 4, [5]],
    ['AS JS 9S 6S 2S', 5, [14, 11, 9, 6, 2]],
    ['AS AD AC 6H 6S', 6, [14, 6]],
    ['AS AD AC AH 2S', 7, [14, 2]],
    ['5S 6S 7S 8S 9S', 8, [9]],
    ['AS KS QS JS 10S', 8, [14]]
  ];
  for (const [text, category, tiebreak] of examples) {
    const value = poker(text);
    assert.equal(value.category, category, text);
    assert.deepEqual(value.tiebreak, tiebreak, text);
    assert.equal(value.cards.length, 5);
  }
  assert.equal(poker('AS KS QS JS 10S').name, 'Royal Flush');
  assert.equal(poker('AS 2S 3S 4S 5S').name, 'Straight Flush');
});

test('poker compares all relevant kickers, full-house ranks, and straight heights', () => {
  const winners = [
    ['AS KD QC 8H 7S', 'AS KD QC 8H 6S'],
    ['AS AD KC QH 9S', 'AS AD KC QH 8S'],
    ['AS AD KC KH 9S', 'AS AD QC QH KS'],
    ['AS AD KC KH 9S', 'AS AD KC KH 8S'],
    ['7S 7D 7C AH 9S', '7S 7D 7C AH 8S'],
    ['2S 3D 4C 5H 6S', 'AS 2D 3C 4H 5S'],
    ['AS KS 9S 6S 3S', 'AS KS 9S 6S 2S'],
    ['7S 7D 7C AH AS', '6S 6D 6C AH AS'],
    ['7S 7D 7C AH AS', '7S 7D 7C KH KS'],
    ['7S 7D 7C 7H AS', '7S 7D 7C 7H KS'],
    ['6S 7S 8S 9S 10S', '5S 6S 7S 8S 9S']
  ];
  for (const [winner, loser] of winners) {
    assert.equal(E.comparePoker(poker(winner), poker(loser)), 1, winner);
    assert.equal(E.comparePoker(poker(loser), poker(winner)), -1, loser);
  }
  assert.equal(E.comparePoker(cards('AS KD QC JH 9S'), cards('AH KC QD JS 9H')), 0);
});

test('best five of seven uses board, double trips, three pairs, and optimal flush', () => {
  assert.deepEqual(poker('AS AD AC KS KD KC 2S').tiebreak, [14, 13]);
  assert.deepEqual(poker('AS AD KS KD QS QD JC').tiebreak, [14, 13, 12]);
  assert.deepEqual(poker('AS QS 10S 9S 7S 4S 2S').tiebreak, [14, 12, 10, 9, 7]);
  assert.deepEqual(poker('AS 2D 3C 4H 5S 6D 7C').tiebreak, [7]);
  assert.equal(E.comparePoker(cards('2S 3D 10H JH QH KH AH'), cards('4S 5D 10H JH QH KH AH')), 0);
  assert.throws(() => E.evaluatePoker(cards('AS KD QC JH')));
});

test('Ultimate street actions and affordability follow 3x/4x, 2x, then 1x/fold', () => {
  const round = ultimate('AS KD', 'QH JC', '2S 4D 6C 8H 10S');
  assert.equal(round.wagered, 20);
  assert.deepEqual(E.ultimateActions(round, 29), ['check']);
  assert.deepEqual(E.ultimateActions(round, 30), ['check', 'play3']);
  assert.deepEqual(E.ultimateActions(round, 40), ['check', 'play3', 'play4']);
  for (const action of ['play1', 'play2', 'fold', 'unknown']) assert.throws(() => E.actUltimate(round, action, 100));
  const before = JSON.stringify(round);
  assert.throws(() => E.actUltimate(round, 'play4', 39));
  assert.equal(JSON.stringify(round), before);
  assert.deepEqual(E.actUltimate(round, 'check', 0), { cost: 0, settled: false });
  assert.equal(round.phase, 'flop');
  assert.deepEqual(E.ultimateActions(round, 19), ['check']);
  assert.deepEqual(E.ultimateActions(round, 20), ['check', 'play2']);
  E.actUltimate(round, 'check', 0);
  assert.equal(round.phase, 'river');
  assert.deepEqual(E.ultimateActions(round, 9), ['fold']);
  assert.deepEqual(E.ultimateActions(round, 10), ['play1', 'fold']);
  assert.throws(() => E.actUltimate(round, 'check', 100));
  assert.deepEqual(E.actUltimate(round, 'play1', 10), { cost: 10, settled: true });
  assert.deepEqual(E.ultimateActions(round, 100), []);
  assert.throws(() => E.actUltimate(round, 'play1', 100));
});

test('early Ultimate raises settle once and add only the chosen Play stake', () => {
  for (const multiplier of [3, 4]) {
    const round = ultimate('AS AD', 'QH JC', '2S 4D 6C 8H 10S', 10, 5);
    assert.deepEqual(E.actUltimate(round, 'play' + multiplier, 100), { cost: multiplier * 10, settled: true });
    assert.equal(round.play, multiplier * 10);
    assert.equal(round.wagered, 25 + multiplier * 10);
  }
  const flop = ultimate('AS AD', 'QH JC', '2S 4D 6C 8H 10S');
  E.actUltimate(flop, 'check');
  assert.deepEqual(E.actUltimate(flop, 'play2', 20), { cost: 20, settled: true });
});

test('unqualified dealer pushes Ante whether player wins or loses', () => {
  const win = playRiver(ultimate('AS KD', 'QH JC', '2S 4D 6C 8H 10S'));
  assert.equal(win.qualifies, false);
  assert.equal(win.result, 'win');
  assert.equal(part(win, 'Ante').returned, 10);
  assert.equal(part(win, 'Blind').returned, 10);
  assert.equal(part(win, 'Play').returned, 20);
  assert.equal(win.returned, 40);
  const loss = playRiver(ultimate('QH JC', 'AS KD', '2S 4D 6C 8H 10S'));
  assert.equal(loss.qualifies, false);
  assert.equal(loss.result, 'lose');
  assert.equal(part(loss, 'Ante').returned, 10);
  assert.equal(part(loss, 'Blind').returned, 0);
  assert.equal(part(loss, 'Play').returned, 0);
  assert.equal(loss.returned, 10);
});

test('qualified dealer pays or collects Ante and Play; sub-straight winning Blind pushes', () => {
  const win = playRiver(ultimate('AS AD', 'KS KD', '2S 4D 6C 8H 10S'));
  assert.equal(win.qualifies, true);
  assert.equal(part(win, 'Ante').returned, 20);
  assert.equal(part(win, 'Play').returned, 20);
  assert.equal(part(win, 'Blind').result, 'push');
  assert.equal(win.returned, 50);
  const loss = playRiver(ultimate('KS KD', 'AS AD', '2S 4D 6C 8H 10S'));
  assert.equal(loss.qualifies, true);
  assert.equal(loss.returned, 0);
});

test('board ties push every main wager; Trips still pays independently', () => {
  const round = playRiver(ultimate('2S 3D', '4S 5D', '10H JH QH KH AH', 10, 5));
  assert.equal(round.result, 'push');
  assert.ok(round.breakdown.slice(0, 3).every(item => item.returned === item.bet && item.result === 'push'));
  assert.equal(part(round, 'Trips').returned, 255);
  assert.equal(round.returned, 285);
});

test('Blind and Trips use the complete configured casino payout tables', () => {
  const examples = [
    ['AS KS', '2D 3C', 'QS JS 10S 7H 6C', 500, 50],
    ['5S 6S', 'AD KC', '7S 8S 9S 2H 3C', 50, 40],
    ['AS AD', 'KD QC', 'AH AC 7D 4H 2S', 10, 30],
    ['AS AD', 'KD QC', 'AH 7C 7D 4H 2S', 3, 8],
    ['AS 9S', 'KD QC', '7S 4S 2S 6H 3D', 1.5, 7],
    ['8S 9D', '4D 6C', '10H JC QS 3H 2D', 1, 4],
    ['AS AD', 'KD QC', 'AH 7C 6D 4H 2S', 0, 3]
  ];
  for (const [player, dealer, board, blindOdds, tripsOdds] of examples) {
    const round = playRiver(ultimate(player, dealer, board, 10, 5));
    assert.equal(round.result, 'win', player);
    assert.equal(part(round, 'Blind').returned, 10 * (blindOdds + 1), round.playerRank.name);
    assert.equal(part(round, 'Trips').returned, 5 * (tripsOdds + 1), round.playerRank.name);
  }
});

test('Trips pays on a losing hand and on a folded hand', () => {
  const loss = playRiver(ultimate('7S 7D', 'AS AD', '7H AC 2D 4H 9S', 10, 5));
  assert.equal(loss.result, 'lose');
  assert.equal(part(loss, 'Trips').returned, 20);
  assert.equal(loss.returned, 20);
  const fold = ultimate('7S 7D', 'AS KD', '7H 10C 2D 4H 9S', 10, 5);
  E.actUltimate(fold, 'check');
  E.actUltimate(fold, 'check');
  assert.deepEqual(E.actUltimate(fold, 'fold', 0), { cost: 0, settled: true });
  assert.equal(fold.result, 'fold');
  assert.equal(fold.qualifies, false);
  assert.equal(part(fold, 'Ante').returned, 0);
  assert.equal(part(fold, 'Blind').returned, 0);
  assert.equal(part(fold, 'Play').bet, 0);
  assert.equal(part(fold, 'Trips').returned, 20);
  assert.equal(fold.returned, 20);
  assert.equal(fold.wagered, 25);
});

test('invalid wagers and undersized decks are rejected before dealing', () => {
  for (const value of [-1, 0, NaN, Infinity, 0.001]) assert.throws(() => E.createBlackjack(value));
  for (const value of [-1, NaN, Infinity, 0.001]) assert.throws(() => E.createUltimate(10, value));
  const deck = cards('AS KD QC');
  assert.throws(() => E.createBlackjack(10, deck));
  assert.equal(deck.length, 3);
  assert.throws(() => E.createUltimate(10, 0, deck));
  assert.equal(deck.length, 3);
});
