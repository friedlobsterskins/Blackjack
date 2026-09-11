(function (root, factory) {
  'use strict';
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.CasinoEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['S', 'H', 'D', 'C'];
  const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const rankValue = card => RANKS.indexOf(card.rank) + 2;
  const blackjackCardValue = card => card.rank === 'A' ? 11 : Math.min(rankValue(card), 10);

  function randomIndex(limit) {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
      const bucket = new Uint32Array(1);
      const ceiling = Math.floor(0x100000000 / limit) * limit;
      do { globalThis.crypto.getRandomValues(bucket); } while (bucket[0] >= ceiling);
      return bucket[0] % limit;
    }
    return Math.floor(Math.random() * limit);
  }

  function makeDeck(decks = 1) {
    if (!Number.isInteger(decks) || decks < 1 || decks > 8) throw new Error('Use between one and eight decks.');
    const cards = [];
    for (let deck = 0; deck < decks; deck++) {
      for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
    }
    for (let i = cards.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  function draw(deck) {
    if (!Array.isArray(deck) || !deck.length) throw new Error('The shoe is empty. Shuffle before the next round.');
    return deck.pop();
  }

  function requireBet(value, allowZero = false) {
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || money(value) !== value) {
      throw new Error('Enter a valid chip amount with at most two decimal places.');
    }
  }

  function blackjackValue(cards) {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
      total += blackjackCardValue(card);
      if (card.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total, soft: aces > 0 };
  }

  function isBlackjack(cards) {
    return cards.length === 2 && blackjackValue(cards).total === 21;
  }

  function newHand(cards, bet, fromSplit = false, splitAces = false) {
    return { cards, bet, fromSplit, splitAces, done: false, doubled: false, result: null, returned: 0 };
  }

  function createBlackjack(bet, shoe = makeDeck(6)) {
    requireBet(bet);
    if (!Array.isArray(shoe) || shoe.length < 4) throw new Error('The shoe needs at least four cards.');
    const player = [draw(shoe)];
    const dealer = [draw(shoe)];
    player.push(draw(shoe));
    dealer.push(draw(shoe));
    const round = {
      game: 'blackjack', shoe, initialBet: bet, hands: [newHand(player, bet)], dealer,
      activeHand: 0, phase: 'player', wagered: bet, returned: 0, result: null,
      insurance: { bet: 0, returned: 0, result: null }, dealerBlackjack: false
    };
    if (dealer[0].rank === 'A') round.phase = 'insurance';
    else finishPeek(round);
    return round;
  }

  function finishPeek(round) {
    round.dealerBlackjack = isBlackjack(round.dealer);
    round.phase = 'player';
    if (round.insurance.bet > 0) {
      round.insurance.returned = round.dealerBlackjack ? money(round.insurance.bet * 3) : 0;
      round.insurance.result = round.dealerBlackjack ? 'win' : 'lose';
    }
    if (round.dealerBlackjack || isBlackjack(round.hands[0].cards)) settleBlackjack(round);
  }

  function affordable(balance, cost) {
    return typeof balance === 'number' && !Number.isNaN(balance) && balance >= money(cost);
  }

  function blackjackActions(round, balance = Infinity) {
    if (!round || round.phase === 'settled') return [];
    if (round.phase === 'insurance') {
      return affordable(balance, round.initialBet / 2) ? ['insurance', 'decline'] : ['decline'];
    }
    if (round.phase !== 'player') return [];
    const hand = round.hands[round.activeHand];
    if (!hand || hand.done) return [];
    const actions = ['hit', 'stand'];
    if (hand.cards.length === 2 && !hand.splitAces && affordable(balance, hand.bet)) {
      actions.push('double');
      if (round.hands.length < 4 && blackjackCardValue(hand.cards[0]) === blackjackCardValue(hand.cards[1])) {
        actions.push('split');
      }
    }
    return actions;
  }

  function advanceBlackjack(round) {
    while (round.activeHand < round.hands.length && round.hands[round.activeHand].done) round.activeHand++;
    if (round.activeHand >= round.hands.length) {
      round.activeHand = Math.max(0, round.hands.length - 1);
      settleBlackjack(round);
    }
  }

  function actBlackjack(round, action, balance = Infinity) {
    if (!blackjackActions(round, balance).includes(action)) throw new Error('That action is not available.');
    let cost = 0;
    if (round.phase === 'insurance') {
      if (action === 'insurance') {
        cost = money(round.initialBet / 2);
        round.insurance.bet = cost;
        round.wagered = money(round.wagered + cost);
      }
      finishPeek(round);
      return { cost, settled: round.phase === 'settled' };
    }
    const hand = round.hands[round.activeHand];
    if (action === 'hit') {
      hand.cards.push(draw(round.shoe));
      hand.done = blackjackValue(hand.cards).total >= 21;
    } else if (action === 'stand') {
      hand.done = true;
    } else if (action === 'double') {
      cost = hand.bet;
      hand.cards.push(draw(round.shoe));
      hand.bet = money(hand.bet * 2);
      hand.doubled = true;
      hand.done = true;
    } else if (action === 'split') {
      cost = hand.bet;
      const aces = hand.cards[0].rank === 'A';
      const left = newHand([hand.cards[0], draw(round.shoe)], hand.bet, true, aces);
      const right = newHand([hand.cards[1], draw(round.shoe)], hand.bet, true, aces);
      left.done = aces || blackjackValue(left.cards).total === 21;
      right.done = aces || blackjackValue(right.cards).total === 21;
      round.hands.splice(round.activeHand, 1, left, right);
    }
    round.wagered = money(round.wagered + cost);
    advanceBlackjack(round);
    return { cost, settled: round.phase === 'settled' };
  }

  function settleBlackjack(round) {
    const dealerNatural = isBlackjack(round.dealer);
    const needsDealerPlay = !dealerNatural && round.hands.some(hand =>
      blackjackValue(hand.cards).total <= 21 && !(isBlackjack(hand.cards) && !hand.fromSplit)
    );
    if (needsDealerPlay) {
      let value = blackjackValue(round.dealer);
      while (value.total < 17 || (value.total === 17 && value.soft)) {
        round.dealer.push(draw(round.shoe));
        value = blackjackValue(round.dealer);
      }
    }
    const dealerTotal = blackjackValue(round.dealer).total;
    for (const hand of round.hands) {
      const playerTotal = blackjackValue(hand.cards).total;
      const natural = isBlackjack(hand.cards) && !hand.fromSplit;
      let multiplier = 0;
      if (playerTotal > 21) hand.result = 'bust';
      else if (dealerNatural) { hand.result = natural ? 'push' : 'lose'; multiplier = natural ? 1 : 0; }
      else if (natural) { hand.result = 'blackjack'; multiplier = 2.5; }
      else if (dealerTotal > 21 || playerTotal > dealerTotal) { hand.result = 'win'; multiplier = 2; }
      else if (playerTotal === dealerTotal) { hand.result = 'push'; multiplier = 1; }
      else hand.result = 'lose';
      hand.returned = money(hand.bet * multiplier);
      hand.done = true;
    }
    round.returned = money(round.hands.reduce((sum, hand) => sum + hand.returned, 0) + round.insurance.returned);
    round.result = round.returned > round.wagered ? 'win' : round.returned < round.wagered ? 'lose' : 'push';
    round.phase = 'settled';
  }

  function compareRank(left, right) {
    if (left.category !== right.category) return Math.sign(left.category - right.category);
    for (let i = 0; i < Math.max(left.tiebreak.length, right.tiebreak.length); i++) {
      const difference = (left.tiebreak[i] || 0) - (right.tiebreak[i] || 0);
      if (difference !== 0) return Math.sign(difference);
    }
    return 0;
  }

  function evaluateFive(cards) {
    const values = cards.map(rankValue).sort((a, b) => b - a);
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    const groups = Array.from(counts, ([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || b.value - a.value);
    const flush = cards.every(card => card.suit === cards[0].suit);
    const unique = [...new Set(values)];
    let straightHigh = 0;
    if (unique.length === 5) {
      if (unique[0] - unique[4] === 4) straightHigh = unique[0];
      else if (unique.join(',') === '14,5,4,3,2') straightHigh = 5;
    }
    let category;
    let name;
    let tiebreak;
    if (straightHigh && flush) {
      category = 8; name = straightHigh === 14 ? 'Royal Flush' : 'Straight Flush'; tiebreak = [straightHigh];
    } else if (groups[0].count === 4) {
      category = 7; name = 'Four of a Kind'; tiebreak = [groups[0].value, groups[1].value];
    } else if (groups[0].count === 3 && groups[1].count === 2) {
      category = 6; name = 'Full House'; tiebreak = [groups[0].value, groups[1].value];
    } else if (flush) {
      category = 5; name = 'Flush'; tiebreak = values;
    } else if (straightHigh) {
      category = 4; name = 'Straight'; tiebreak = [straightHigh];
    } else if (groups[0].count === 3) {
      category = 3; name = 'Three of a Kind'; tiebreak = groups.map(group => group.value);
    } else if (groups[0].count === 2 && groups[1].count === 2) {
      category = 2; name = 'Two Pair'; tiebreak = groups.map(group => group.value);
    } else if (groups[0].count === 2) {
      category = 1; name = 'One Pair'; tiebreak = groups.map(group => group.value);
    } else {
      category = 0; name = 'High Card'; tiebreak = values;
    }
    return { category, name, tiebreak, cards: cards.slice() };
  }

  function evaluatePoker(cards) {
    if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) throw new Error('Poker evaluation needs five to seven cards.');
    let best = null;
    for (let a = 0; a < cards.length - 4; a++) {
      for (let b = a + 1; b < cards.length - 3; b++) {
        for (let c = b + 1; c < cards.length - 2; c++) {
          for (let d = c + 1; d < cards.length - 1; d++) {
            for (let e = d + 1; e < cards.length; e++) {
              const rank = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
              if (!best || compareRank(rank, best) > 0) best = rank;
            }
          }
        }
      }
    }
    return best;
  }

  function comparePoker(left, right) {
    return compareRank(Array.isArray(left) ? evaluatePoker(left) : left, Array.isArray(right) ? evaluatePoker(right) : right);
  }

  function createUltimate(ante, trips = 0, deck = makeDeck()) {
    requireBet(ante);
    requireBet(trips, true);
    if (!Array.isArray(deck) || deck.length < 9) throw new Error('The deck needs at least nine cards.');
    const player = [draw(deck)];
    const dealer = [draw(deck)];
    player.push(draw(deck));
    dealer.push(draw(deck));
    const board = [draw(deck), draw(deck), draw(deck), draw(deck), draw(deck)];
    return {
      game: 'ultimate', ante, blind: ante, trips, play: 0, player, dealer, board, deck,
      phase: 'preflop', wagered: money(ante * 2 + trips), returned: 0,
      result: null, breakdown: [], playerRank: null, dealerRank: null, qualifies: null
    };
  }

  function ultimateActions(round, balance = Infinity) {
    if (!round || round.phase === 'settled') return [];
    if (round.phase === 'preflop') {
      const actions = ['check'];
      if (affordable(balance, round.ante * 3)) actions.push('play3');
      if (affordable(balance, round.ante * 4)) actions.push('play4');
      return actions;
    }
    if (round.phase === 'flop') return affordable(balance, round.ante * 2) ? ['check', 'play2'] : ['check'];
    if (round.phase === 'river') return affordable(balance, round.ante) ? ['play1', 'fold'] : ['fold'];
    return [];
  }

  function actUltimate(round, action, balance = Infinity) {
    if (!ultimateActions(round, balance).includes(action)) throw new Error('That action is not available.');
    let cost = 0;
    if (action === 'check') round.phase = round.phase === 'preflop' ? 'flop' : 'river';
    else {
      if (action !== 'fold') {
        cost = money(round.ante * Number(action.slice(4)));
        round.play = cost;
        round.wagered = money(round.wagered + cost);
      }
      settleUltimate(round, action === 'fold');
    }
    return { cost, settled: round.phase === 'settled' };
  }

  function settleUltimate(round, folded) {
    round.playerRank = evaluatePoker(round.player.concat(round.board));
    round.dealerRank = evaluatePoker(round.dealer.concat(round.board));
    round.qualifies = round.dealerRank.category >= 1;
    const comparison = comparePoker(round.playerRank, round.dealerRank);
    const royal = round.playerRank.category === 8 && round.playerRank.tiebreak[0] === 14;
    const blindOdds = royal ? 500 : ({ 8: 50, 7: 10, 6: 3, 5: 1.5, 4: 1 }[round.playerRank.category] || 0);
    const tripsOdds = royal ? 50 : ({ 8: 40, 7: 30, 6: 8, 5: 7, 4: 4, 3: 3 }[round.playerRank.category] || 0);
    const entry = (label, bet, multiplier, result) => ({ label, bet, returned: money(bet * multiplier), result: bet ? result : 'inactive' });
    let ante;
    let blind;
    let play;
    if (folded) {
      ante = entry('Ante', round.ante, 0, 'lose');
      blind = entry('Blind', round.blind, 0, 'lose');
      play = entry('Play', round.play, 0, 'lose');
      round.result = 'fold';
    } else {
      const result = comparison > 0 ? 'win' : comparison < 0 ? 'lose' : 'push';
      ante = !round.qualifies ? entry('Ante', round.ante, 1, 'push') :
        entry('Ante', round.ante, comparison + 1, result);
      play = entry('Play', round.play, comparison + 1, result);
      blind = comparison > 0 ? entry('Blind', round.blind, blindOdds + 1, blindOdds > 0 ? 'win' : 'push') :
        entry('Blind', round.blind, comparison + 1, result);
      round.result = result;
    }
    const trips = entry('Trips', round.trips, tripsOdds ? tripsOdds + 1 : 0, tripsOdds ? 'win' : 'lose');
    round.breakdown = [ante, blind, play, trips];
    round.returned = money(round.breakdown.reduce((sum, item) => sum + item.returned, 0));
    round.phase = 'settled';
  }

  return { makeDeck, blackjackValue, isBlackjack, createBlackjack, blackjackActions, actBlackjack,
    evaluatePoker, comparePoker, createUltimate, ultimateActions, actUltimate };
});
