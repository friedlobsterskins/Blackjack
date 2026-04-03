const suits = ['♠', '♥', '♦', '♣'];
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const AUTO_NEXT_ROUND_DELAY = 100;

let deck = [];
let players = [];
let dealer = { hand: [], isRevealed: false };

let currentExpectedTotal = 0;
let actionCallback = null;
let activePlayerIdx = -1;
let activeHandIdx = -1;
let roundActive = false;
let nextRoundTimer = null;
let isClearingRound = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildDeck() {
  deck = [];

  for (let d = 0; d < 6; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ rank, suit });
      }
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function getVal(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank, 10);
}

function getBestTotal(hand) {
  let total = 0;
  let aces = 0;

  hand.forEach((card) => {
    total += getVal(card.rank);
    if (card.rank === 'A') aces++;
  });

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

function botAction(hand, dealerUpVal) {
  const total = getBestTotal(hand);
  const hasAce = hand.some((card) => card.rank === 'A');
  const hardTotal = hand.reduce(
    (sum, card) => sum + (card.rank === 'A' ? 1 : getVal(card.rank)),
    0
  );
  const isSoft = hasAce && hardTotal + 10 <= 21;

  if (
    hand.length === 2 &&
    (total === 10 || total === 11) &&
    dealerUpVal >= 2 &&
    dealerUpVal <= 9
  ) {
    return 'DOUBLE';
  }

  if (total <= 11) return 'HIT';
  if (total >= 17 && !isSoft) return 'STAND';

  if (isSoft) {
    if (total <= 17) return 'HIT';
    if (total === 18 && [9, 10, 11].includes(dealerUpVal)) return 'HIT';
    return 'STAND';
  }

  if (total === 12 && dealerUpVal >= 4 && dealerUpVal <= 6) return 'STAND';
  if (total >= 13 && total <= 16 && dealerUpVal >= 2 && dealerUpVal <= 6) return 'STAND';

  return 'HIT';
}

function getChipColor(amount) {
  if (amount >= 100) return '#1d1d1f';
  if (amount >= 25) return '#28a45e';
  if (amount >= 5) return '#d95c55';
  return '#2f6fd3';
}

function generateCardHTML(card, isHidden = false, isNewest = false, isSideways = false) {
  const newestClass = isNewest ? 'animate-new' : '';
  const sidewaysClass = isSideways ? 'sideways' : '';

  if (isHidden) {
    return `<div class="card hidden ${newestClass}"></div>`;
  }

  const colorClass = ['♥', '♦'].includes(card.suit) ? 'red' : '';

  return `
    <div class="card ${colorClass} ${sidewaysClass} ${newestClass}">
      <div class="card-corner-top">
        <span class="card-rank">${card.rank}</span>
        <span class="card-suit-mini">${card.suit}</span>
      </div>
      <div class="card-center">${card.suit}</div>
      <div class="card-corner-bottom">
        <span class="card-rank">${card.rank}</span>
        <span class="card-suit-mini">${card.suit}</span>
      </div>
    </div>
  `;
}

function renderTable(animatingCardIdx = -1) {
  const dealerHandEl = document.getElementById('dealer-hand');
  dealerHandEl.innerHTML = dealer.hand
    .map((card, i) => {
      const isHidden = i === 1 && !dealer.isRevealed;
      const isNewest = animatingCardIdx === `dealer-${i}`;
      return generateCardHTML(card, isHidden, isNewest, false);
    })
    .join('');

  const playersArcEl = document.getElementById('players-arc');
  playersArcEl.innerHTML = players
    .map((player, pIdx) => {
      const handsHtml = player.hands
        .map((hand, hIdx) => {
          const isFocus = pIdx === activePlayerIdx && hIdx === activeHandIdx;
          const stateClass =
            isFocus
              ? 'spotlight'
              : activePlayerIdx !== -1
                ? 'dimmed'
                : '';

          const cardsHtml = hand.cards
            .map((card, i) => {
              const isSideways = hand.isDouble && i === 2;
              const isNewest = animatingCardIdx === `player-${pIdx}-${hIdx}-${i}`;
              return generateCardHTML(card, false, isNewest, isSideways);
            })
            .join('');

          return `
            <div class="hand-shell ${stateClass}">
              <div class="hand">${cardsHtml}</div>
            </div>
          `;
        })
        .join('');

      return `
        <div class="player-spot" id="spot-${pIdx}">
          <div class="seat-arc"></div>
          <div class="hands-row">${handsHtml}</div>
          <div class="bet-area">
            <div class="chip" style="background:${getChipColor(player.bet)};">
              <span>$${player.bet}</span>
            </div>
          </div>
          <div class="spot-name">Spot ${pIdx + 1}</div>
        </div>
      `;
    })
    .join('');

  const dealerSpotEl = document.getElementById('dealer-spot');
  dealerSpotEl.classList.remove('spotlight', 'dimmed');

  if (activePlayerIdx === 'dealer') {
    dealerSpotEl.classList.add('spotlight');
  } else if (activePlayerIdx >= 0) {
    dealerSpotEl.classList.add('dimmed');
  }
}

function cancelNextRoundTimer() {
  if (nextRoundTimer) {
    clearTimeout(nextRoundTimer);
    nextRoundTimer = null;
  }
}

function isGameVisible() {
  return getComputedStyle(document.getElementById('game-mode')).display !== 'none';
}

async function clearTableForNextRound() {
  if (isClearingRound) return;
  isClearingRound = true;

  const exitEls = [
    ...document.querySelectorAll('#dealer-hand .card'),
    ...document.querySelectorAll('.players-row .card'),
    ...document.querySelectorAll('.players-row .bet-area'),
    ...document.querySelectorAll('.players-row .spot-name'),
    ...document.querySelectorAll('#dealer-status')
  ];

  if (!exitEls.length) {
    isClearingRound = false;
    return;
  }

  exitEls.forEach((el, index) => {
    el.style.setProperty('--exit-delay', `${index * 18}ms`);
    el.classList.add('round-exit');
  });

  const totalDuration = Math.min(800, 420 + exitEls.length * 18);
  await sleep(totalDuration);

  isClearingRound = false;
}

const hud = document.getElementById('action-hud');
const hudTitle = document.getElementById('hud-title');
const hudInput = document.getElementById('hud-input');
const dealBtn = document.getElementById('deal-btn');
const dealerStatus = document.getElementById('dealer-status');

function promptDealer(expected, title, callback) {
  if (!roundActive) return;

  currentExpectedTotal = expected;
  actionCallback = callback;
  hudTitle.innerText = title;
  hud.classList.remove('hud-hidden');
  hudInput.value = '';
  hudInput.classList.remove('error-shake');

  setTimeout(() => {
    if (roundActive) hudInput.focus();
  }, 50);
}

hudInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !roundActive) return;

  const val = parseInt(hudInput.value, 10);

  if (val === currentExpectedTotal) {
    hud.classList.add('hud-hidden');
    if (typeof actionCallback === 'function') actionCallback();
  } else {
    hudInput.classList.remove('error-shake');
    void hudInput.offsetWidth;
    hudInput.classList.add('error-shake');
    hudInput.value = '';
  }
});

async function startRound() {
  cancelNextRoundTimer();

  if (roundActive || !isGameVisible()) return;

  roundActive = true;
  hud.classList.add('hud-hidden');
  dealerStatus.innerText = '';
  dealBtn.style.display = 'none';

  if (deck.length < 50) buildDeck();

  activePlayerIdx = -1;
  activeHandIdx = -1;

  const bets = [10, 15, 25, 50, 100];

  players = Array.from({ length: 3 }, () => ({
    bet: bets[Math.floor(Math.random() * bets.length)],
    hands: [{ cards: [], isDouble: false }]
  }));

  dealer = { hand: [], isRevealed: false };

  renderTable();

  for (let i = 0; i < 2; i++) {
    for (let pIdx = 0; pIdx < players.length; pIdx++) {
      if (!roundActive) return;

      players[pIdx].hands[0].cards.push(deck.pop());
      renderTable(`player-${pIdx}-0-${i}`);
      await sleep(170);
    }

    if (!roundActive) return;

    dealer.hand.push(deck.pop());
    renderTable(`dealer-${i}`);
    await sleep(170);
  }

  if (roundActive) {
    setTimeout(() => playHand(0, 0), 350);
  }
}

async function playHand(pIdx, hIdx) {
  if (!roundActive) return;

  if (pIdx >= players.length) {
    return playDealer();
  }

  activePlayerIdx = pIdx;
  activeHandIdx = hIdx;
  renderTable();

  const handObj = players[pIdx].hands[hIdx];
  const cards = handObj.cards;
  const total = getBestTotal(cards);
  const upCardVal = getVal(dealer.hand[0].rank);

  if (cards.length === 2 && total === 21) {
    promptDealer(21, `SPOT ${pIdx + 1} BLACKJACK`, () => nextHand(pIdx, hIdx));
    return;
  }

  promptDealer(total, `SPOT ${pIdx + 1} TOTAL`, async () => {
    if (!roundActive) return;

    if (total >= 21 || handObj.isDouble) {
      return nextHand(pIdx, hIdx);
    }

    if (
      cards.length === 2 &&
      cards[0].rank === cards[1].rank &&
      ['8', 'A'].includes(cards[0].rank)
    ) {
      const isAces = cards[0].rank === 'A';

      players[pIdx].hands = [
        { cards: [cards[0]], isDouble: false },
        { cards: [cards[1]], isDouble: false }
      ];

      if (isAces) {
        players[pIdx].hands[0].cards.push(deck.pop());
        players[pIdx].hands[1].cards.push(deck.pop());
        renderTable(`player-${pIdx}-1-1`);

        promptDealer(
          getBestTotal(players[pIdx].hands[0].cards),
          'SPLIT ACE 1',
          () => {
            activeHandIdx = 1;
            renderTable();

            promptDealer(
              getBestTotal(players[pIdx].hands[1].cards),
              'SPLIT ACE 2',
              () => nextHand(pIdx, 1)
            );
          }
        );
      } else {
        players[pIdx].hands[0].cards.push(deck.pop());
        renderTable(`player-${pIdx}-0-1`);
        await sleep(240);
        return playHand(pIdx, 0);
      }

      return;
    }

    const action = botAction(cards, upCardVal);

    if (action === 'DOUBLE') {
      players[pIdx].bet *= 2;
      handObj.isDouble = true;
      handObj.cards.push(deck.pop());

      renderTable(`player-${pIdx}-${hIdx}-2`);
      await sleep(280);

      promptDealer(
        getBestTotal(handObj.cards),
        `SPOT ${pIdx + 1} DOUBLE DOWN`,
        () => nextHand(pIdx, hIdx)
      );
      return;
    }

    if (action === 'HIT') {
      const hitIdx = handObj.cards.length;
      handObj.cards.push(deck.pop());

      renderTable(`player-${pIdx}-${hIdx}-${hitIdx}`);
      await sleep(240);

      return playHand(pIdx, hIdx);
    }

    nextHand(pIdx, hIdx);
  });
}

function nextHand(pIdx, hIdx) {
  if (hIdx + 1 < players[pIdx].hands.length) {
    playHand(pIdx, hIdx + 1);
  } else {
    playHand(pIdx + 1, 0);
  }
}

function finishRound(message) {
  dealerStatus.innerText = message;
  activePlayerIdx = -1;
  activeHandIdx = -1;
  roundActive = false;
  renderTable();

  cancelNextRoundTimer();
  nextRoundTimer = setTimeout(async () => {
    if (!roundActive && isGameVisible()) {
      await clearTableForNextRound();
      if (!roundActive && isGameVisible()) {
        startRound();
      }
    }
  }, AUTO_NEXT_ROUND_DELAY);
}

function playDealer() {
  if (!roundActive) return;

  activePlayerIdx = 'dealer';
  activeHandIdx = -1;
  dealer.isRevealed = true;
  renderTable();

  const dealerStep = () => {
    if (!roundActive) return;

    const total = getBestTotal(dealer.hand);

    promptDealer(total, 'DEALER TOTAL', async () => {
      if (!roundActive) return;

      if (total < 17) {
        const hitIdx = dealer.hand.length;
        dealer.hand.push(deck.pop());

        renderTable(`dealer-${hitIdx}`);
        await sleep(320);
        dealerStep();
        return;
      }

      finishRound(total > 21 ? 'Dealer busts' : `Stands on ${total}`);
    });
  };

  setTimeout(dealerStep, 350);
}

/* ---------- PAYOUT MODE ---------- */

let streak = 0;
const payoutBet = document.getElementById('payout-bet');
const payoutInput = document.getElementById('payout-input');
const payoutFeedback = document.getElementById('payout-feedback');

function nextPayout() {
  const bet = Math.floor(Math.random() * 50) + 1;
  payoutBet.innerText = bet;
  payoutInput.value = '';
  payoutInput.dataset.correct = (bet * 1.5).toFixed(2);
  payoutInput.focus();
}

payoutInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;

  const val = parseFloat(payoutInput.value);
  const correct = parseFloat(payoutInput.dataset.correct);

  if (Math.abs(val - correct) < 0.01) {
    payoutFeedback.innerText = '✅ CORRECT';
    payoutFeedback.style.color = 'var(--success)';
    streak++;
    document.getElementById('payout-streak').innerText = streak;

    setTimeout(() => {
      payoutFeedback.innerText = '';
      nextPayout();
    }, 600);
  } else {
    payoutFeedback.innerText = `❌ WRONG. $${payoutBet.innerText} pays $${correct.toFixed(2)}`;
    payoutFeedback.style.color = 'var(--danger)';
    streak = 0;
    document.getElementById('payout-streak').innerText = streak;

    setTimeout(() => {
      payoutFeedback.innerText = '';
      nextPayout();
    }, 1800);
  }
});

/* ---------- TABS ---------- */

function switchTab(mode) {
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.remove('active');
  });

  document.getElementById(`tab-${mode}`).classList.add('active');

  if (mode === 'game') {
    document.getElementById('payout-mode').style.display = 'none';
    document.getElementById('game-mode').style.display = 'grid';

    if (!roundActive) {
      setTimeout(() => {
        if (!roundActive && isGameVisible()) {
          startRound();
        }
      }, 220);
    }
  } else {
    cancelNextRoundTimer();
    roundActive = false;
    activePlayerIdx = -1;
    activeHandIdx = -1;
    hud.classList.add('hud-hidden');
    dealBtn.style.display = 'none';

    document.getElementById('game-mode').style.display = 'none';
    document.getElementById('payout-mode').style.display = 'grid';

    renderTable();
    nextPayout();
  }
}

/* ---------- RESPONSIVE TABLE SCALE ---------- */

function updateTableScale() {
  const shell = document.getElementById('table-shell');
  if (!shell) return;

  const rect = shell.getBoundingClientRect();
  const designWidth = 1500;
  const designHeight = 720;

  const scale = Math.min(rect.width / designWidth, rect.height / designHeight);
  const safeScale = Math.max(0.56, Math.min(1, scale));

  document.documentElement.style.setProperty('--table-scale', safeScale.toFixed(3));
}

window.addEventListener('resize', updateTableScale);
window.addEventListener('orientationchange', updateTableScale);

window.addEventListener('load', () => {
  buildDeck();
  updateTableScale();
  renderTable();
  setTimeout(startRound, 350);
});

if ('ResizeObserver' in window) {
  const resizeObserver = new ResizeObserver(() => updateTableScale());

  window.addEventListener('load', () => {
    const shell = document.getElementById('table-shell');
    if (shell) resizeObserver.observe(shell);
  });
}
