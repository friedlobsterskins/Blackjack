const suits = ['♠', '♥', '♦', '♣'];
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const AUTO_NEXT_ROUND_DELAY = 200;
const STORAGE_KEYS = {
  app: 'blackjackTrainerAppState',
  game: 'blackjackTrainerGameState',
  payout: 'blackjackTrainerPayoutState'
};

let deck = [];
let players = [];
let dealer = { hand: [], isRevealed: false };

let currentExpectedTotal = 0;
let actionContext = null;
let activePlayerIdx = -1;
let activeHandIdx = -1;
let roundActive = false;
let nextRoundTimer = null;
let gameFlowTimer = null;
let isClearingRound = false;
let gamePaused = false;
let gamePhase = { type: 'idle' };
let activeTab = 'game';

let payoutMode = 'random';
let payoutLocked = false;
let payoutAdvanceTimer = null;

const payoutState = {
  random: {
    currentBet: 1,
    inputValue: '',
    feedback: '',
    currentStreak: 0,
    bestStreak: 0,
    pendingAdvance: null,
    pendingFeedbackType: ''
  },
  sprint: {
    currentBet: 1,
    inputValue: '',
    feedback: '',
    progress: 0,
    currentStreak: 0,
    bestStreak: 0,
    elapsedMs: 0,
    timerRunning: false,
    timerStartedAt: 0,
    hasStarted: false,
    completed: false
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const centerConsole = document.getElementById('center-console');
const hud = document.getElementById('action-hud');
const hudTitle = document.getElementById('hud-title');
const hudInput = document.getElementById('hud-input');
const dealBtn = document.getElementById('deal-btn');
const dealerStatus = document.getElementById('dealer-status');

const payoutWidget = document.getElementById('payout-widget');
const payoutModeEl = document.getElementById('payout-mode');
const payoutBet = document.getElementById('payout-bet');
const payoutInput = document.getElementById('payout-input');
const payoutFeedback = document.getElementById('payout-feedback');
const payoutDescription = document.getElementById('payout-description');
const payoutModeRandomBtn = document.getElementById('payout-mode-random');
const payoutModeSprintBtn = document.getElementById('payout-mode-sprint');
const payoutProgress = document.getElementById('payout-progress');
const payoutTimer = document.getElementById('payout-timer');
const randomCurrentStreakEl = document.getElementById('random-current-streak');
const randomBestStreakEl = document.getElementById('random-best-streak');
const sprintCurrentStreakEl = document.getElementById('sprint-current-streak');
const sprintBestStreakEl = document.getElementById('sprint-best-streak');

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function safeLocalStorageGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAppState() {
  safeLocalStorageSet(STORAGE_KEYS.app, { activeTab });
}

function loadAppState() {
  const state = safeLocalStorageGet(STORAGE_KEYS.app);
  if (state?.activeTab === 'game' || state?.activeTab === 'payout') {
    activeTab = state.activeTab;
  }
}

function buildDeck() {
  deck = [];

  for (let d = 0; d < 6; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ rank, suit });
      }
    }
  }

  shuffleDeck(deck);
}

function shuffleDeck(targetDeck) {
  for (let i = targetDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [targetDeck[i], targetDeck[j]] = [targetDeck[j], targetDeck[i]];
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
    if (card.rank === 'A') aces += 1;
  });

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
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

function triggerSuccessEffect(...elements) {
  elements.filter(Boolean).forEach((element) => {
    element.classList.remove('success-pop', 'success-flash');
    void element.offsetWidth;
    element.classList.add('success-pop', 'success-flash');

    setTimeout(() => {
      element.classList.remove('success-pop', 'success-flash');
    }, 760);
  });
}

function cancelNextRoundTimer() {
  if (nextRoundTimer) {
    clearTimeout(nextRoundTimer);
    nextRoundTimer = null;
  }
}

function cancelGameFlowTimer() {
  if (gameFlowTimer) {
    clearTimeout(gameFlowTimer);
    gameFlowTimer = null;
  }
}

function isGameVisible() {
  return getComputedStyle(document.getElementById('game-mode')).display !== 'none';
}

function isPayoutVisible() {
  return getComputedStyle(document.getElementById('payout-mode')).display !== 'none';
}

function updateCenterConsoleVisibility() {
  centerConsole.classList.toggle('console-hidden', activeTab !== 'game');
}

function updatePayoutFitScale() {
  if (!payoutModeEl || !payoutWidget) return;
  if (!isPayoutVisible()) return;

  document.documentElement.style.setProperty('--payout-fit-scale', '1');

  requestAnimationFrame(() => {
    const modeRect = payoutModeEl.getBoundingClientRect();

    const paddingX = 24;
    const paddingY = 24;
    const availableWidth = Math.max(240, modeRect.width - paddingX * 2);
    const availableHeight = Math.max(240, modeRect.height - paddingY * 2);

    const naturalWidth = payoutWidget.offsetWidth;
    const naturalHeight = payoutWidget.offsetHeight;

    if (!naturalWidth || !naturalHeight) return;

    const widthScale = availableWidth / naturalWidth;
    const heightScale = availableHeight / naturalHeight;
    const scale = Math.min(1, widthScale, heightScale);

    document.documentElement.style.setProperty('--payout-fit-scale', scale.toFixed(4));
  });
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

function saveGameState() {
  safeLocalStorageSet(STORAGE_KEYS.game, {
    deck,
    players,
    dealer,
    currentExpectedTotal,
    actionContext,
    activePlayerIdx,
    activeHandIdx,
    roundActive,
    gamePaused,
    gamePhase,
    dealerStatusText: dealerStatus.innerText,
    hudTitleText: hudTitle.innerText,
    hudVisible: !hud.classList.contains('hud-hidden') && activeTab === 'game'
  });
}

function restoreGameState() {
  const state = safeLocalStorageGet(STORAGE_KEYS.game);
  if (!state) return false;

  deck = Array.isArray(state.deck) && state.deck.length ? state.deck : [];
  players = Array.isArray(state.players) ? state.players : [];
  dealer = state.dealer?.hand ? state.dealer : { hand: [], isRevealed: false };
  currentExpectedTotal = Number.isFinite(state.currentExpectedTotal) ? state.currentExpectedTotal : 0;
  actionContext = state.actionContext ?? null;
  activePlayerIdx = state.activePlayerIdx ?? -1;
  activeHandIdx = state.activeHandIdx ?? -1;
  roundActive = Boolean(state.roundActive);
  gamePaused = true;
  gamePhase = state.gamePhase ?? { type: 'idle' };
  dealerStatus.innerText = state.dealerStatusText ?? '';
  hudTitle.innerText = state.hudTitleText ?? 'SPOT 1 TOTAL';
  hud.classList.add('hud-hidden');
  dealBtn.style.display = 'none';
  renderTable();
  return players.length > 0 || dealer.hand.length > 0 || roundActive;
}

function scheduleGameAction(action, delay = 0) {
  cancelGameFlowTimer();
  gamePhase = { type: 'resume-action', action };
  saveGameState();

  if (gamePaused || !isGameVisible()) return;

  gameFlowTimer = setTimeout(() => {
    gameFlowTimer = null;
    dispatchGameAction(action);
  }, delay);
}

function promptDealer(expected, title, nextAction) {
  if (!roundActive) return;

  currentExpectedTotal = expected;
  actionContext = nextAction;
  hudTitle.innerText = title;
  if (activeTab === 'game') {
    hud.classList.remove('hud-hidden');
  }
  hudInput.value = '';
  hudInput.classList.remove('error-shake');
  gamePhase = {
    type: 'prompt',
    expected,
    title,
    action: nextAction
  };
  saveGameState();

  setTimeout(() => {
    if (roundActive && isGameVisible()) hudInput.focus();
  }, 50);
}

function dealInitialStep(step = 0) {
  if (!roundActive) return;

  if (step >= 8) {
    scheduleGameAction({ type: 'playHand', pIdx: 0, hIdx: 0 }, 350);
    return;
  }

  const cycle = Math.floor(step / 4);
  const seat = step % 4;

  if (seat < players.length) {
    players[seat].hands[0].cards.push(deck.pop());
    renderTable(`player-${seat}-0-${cycle}`);
  } else {
    dealer.hand.push(deck.pop());
    renderTable(`dealer-${cycle}`);
  }

  gamePhase = { type: 'dealing', step: step + 1 };
  saveGameState();
  scheduleGameAction({ type: 'dealInitialStep', step: step + 1 }, 170);
}

function startRound() {
  cancelNextRoundTimer();
  cancelGameFlowTimer();

  if ((roundActive && gamePhase.type !== 'round-finished') || isClearingRound) return;
  if (!isGameVisible()) return;

  roundActive = true;
  gamePaused = false;
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
  gamePhase = { type: 'dealing', step: 0 };
  renderTable();
  saveGameState();
  scheduleGameAction({ type: 'dealInitialStep', step: 0 }, 80);
}

function playHand(pIdx, hIdx) {
  if (!roundActive) return;

  if (pIdx >= players.length) {
    playDealerStart();
    return;
  }

  activePlayerIdx = pIdx;
  activeHandIdx = hIdx;
  renderTable();

  const handObj = players[pIdx].hands[hIdx];
  const cards = handObj.cards;
  const total = getBestTotal(cards);

  if (cards.length === 2 && total === 21) {
    promptDealer(21, `SPOT ${pIdx + 1} BLACKJACK`, { type: 'nextHand', pIdx, hIdx });
    return;
  }

  promptDealer(total, `SPOT ${pIdx + 1} TOTAL`, { type: 'resolveHandAction', pIdx, hIdx });
}

function resolveHandAction(pIdx, hIdx) {
  if (!roundActive) return;

  const handObj = players[pIdx]?.hands[hIdx];
  if (!handObj) return;

  const cards = handObj.cards;
  const total = getBestTotal(cards);
  const upCardVal = getVal(dealer.hand[0].rank);

  if (total >= 21 || handObj.isDouble) {
    nextHand(pIdx, hIdx);
    return;
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
      activeHandIdx = 0;
      renderTable(`player-${pIdx}-1-1`);
      saveGameState();
      scheduleGameAction({ type: 'splitAcePromptFirst', pIdx }, 240);
      return;
    }

    players[pIdx].hands[0].cards.push(deck.pop());
    renderTable(`player-${pIdx}-0-1`);
    saveGameState();
    scheduleGameAction({ type: 'playHand', pIdx, hIdx: 0 }, 240);
    return;
  }

  const action = botAction(cards, upCardVal);

  if (action === 'DOUBLE') {
    players[pIdx].bet *= 2;
    handObj.isDouble = true;
    handObj.cards.push(deck.pop());

    renderTable(`player-${pIdx}-${hIdx}-2`);
    saveGameState();
    scheduleGameAction({ type: 'afterDouble', pIdx, hIdx }, 280);
    return;
  }

  if (action === 'HIT') {
    const hitIdx = handObj.cards.length;
    handObj.cards.push(deck.pop());

    renderTable(`player-${pIdx}-${hIdx}-${hitIdx}`);
    saveGameState();
    scheduleGameAction({ type: 'playHand', pIdx, hIdx }, 240);
    return;
  }

  nextHand(pIdx, hIdx);
}

function nextHand(pIdx, hIdx) {
  if (hIdx + 1 < players[pIdx].hands.length) {
    playHand(pIdx, hIdx + 1);
  } else {
    playHand(pIdx + 1, 0);
  }
}

function playDealerStart() {
  if (!roundActive) return;

  activePlayerIdx = 'dealer';
  activeHandIdx = -1;
  dealer.isRevealed = true;
  renderTable();
  saveGameState();
  scheduleGameAction({ type: 'dealerStep' }, 350);
}

function dealerStep() {
  if (!roundActive) return;

  const total = getBestTotal(dealer.hand);
  promptDealer(total, 'DEALER TOTAL', { type: 'resolveDealerAction' });
}

function resolveDealerAction() {
  if (!roundActive) return;

  const total = getBestTotal(dealer.hand);

  if (total < 17) {
    const hitIdx = dealer.hand.length;
    dealer.hand.push(deck.pop());

    renderTable(`dealer-${hitIdx}`);
    saveGameState();
    scheduleGameAction({ type: 'dealerStep' }, 320);
    return;
  }

  finishRound(total > 21 ? 'Dealer busts' : `Stands on ${total}`);
}

function finishRound(message) {
  dealerStatus.innerText = message;
  activePlayerIdx = -1;
  activeHandIdx = -1;
  roundActive = false;
  gamePhase = { type: 'round-finished' };
  hud.classList.add('hud-hidden');
  renderTable();
  saveGameState();

  cancelNextRoundTimer();
  nextRoundTimer = setTimeout(async () => {
    if (roundActive || !isGameVisible()) return;
    await clearTableForNextRound();
    if (!roundActive && isGameVisible()) {
      startRound();
    }
  }, AUTO_NEXT_ROUND_DELAY);
}

function dispatchGameAction(action) {
  if (!action) return;

  switch (action.type) {
    case 'dealInitialStep':
      dealInitialStep(action.step);
      break;
    case 'playHand':
      playHand(action.pIdx, action.hIdx);
      break;
    case 'resolveHandAction':
      resolveHandAction(action.pIdx, action.hIdx);
      break;
    case 'nextHand':
      nextHand(action.pIdx, action.hIdx);
      break;
    case 'splitAcePromptFirst':
      promptDealer(
        getBestTotal(players[action.pIdx].hands[0].cards),
        'SPLIT ACE 1',
        { type: 'splitAcePromptSecond', pIdx: action.pIdx }
      );
      break;
    case 'splitAcePromptSecond':
      activeHandIdx = 1;
      renderTable();
      promptDealer(
        getBestTotal(players[action.pIdx].hands[1].cards),
        'SPLIT ACE 2',
        { type: 'nextHand', pIdx: action.pIdx, hIdx: 1 }
      );
      break;
    case 'afterDouble':
      promptDealer(
        getBestTotal(players[action.pIdx].hands[action.hIdx].cards),
        `SPOT ${action.pIdx + 1} DOUBLE DOWN`,
        { type: 'nextHand', pIdx: action.pIdx, hIdx: action.hIdx }
      );
      break;
    case 'dealerStep':
      dealerStep();
      break;
    case 'resolveDealerAction':
      resolveDealerAction();
      break;
    default:
      break;
  }
}

function pauseGame() {
  gamePaused = true;
  cancelGameFlowTimer();
  cancelNextRoundTimer();
  hud.classList.add('hud-hidden');
  saveGameState();
}

function resumeGame() {
  if (!isGameVisible()) return;

  gamePaused = false;
  saveGameState();

  if (gamePhase.type === 'prompt') {
    hud.classList.remove('hud-hidden');
    setTimeout(() => {
      if (isGameVisible()) hudInput.focus();
    }, 50);
    return;
  }

  if (gamePhase.type === 'dealing') {
    scheduleGameAction({ type: 'dealInitialStep', step: gamePhase.step ?? 0 }, 120);
    return;
  }

  if (gamePhase.type === 'resume-action' && gamePhase.action) {
    scheduleGameAction(gamePhase.action, 120);
    return;
  }

  if (gamePhase.type === 'round-finished') {
    nextRoundTimer = setTimeout(async () => {
      if (roundActive || !isGameVisible()) return;
      await clearTableForNextRound();
      if (!roundActive && isGameVisible()) {
        startRound();
      }
    }, AUTO_NEXT_ROUND_DELAY);
    return;
  }

  if (!roundActive && players.length === 0 && dealer.hand.length === 0) {
    startRound();
  }
}

hudInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !roundActive) return;

  const val = parseInt(hudInput.value, 10);

  if (val === currentExpectedTotal) {
    triggerSuccessEffect(hud, hudInput);
    hud.classList.add('hud-hidden');
    const nextAction = actionContext;
    actionContext = null;
    dispatchGameAction(nextAction);
    saveGameState();
  } else {
    hudInput.classList.remove('error-shake');
    void hudInput.offsetWidth;
    hudInput.classList.add('error-shake');
    hudInput.value = '';
  }
});

function cancelPayoutAdvanceTimer() {
  if (payoutAdvanceTimer) {
    clearTimeout(payoutAdvanceTimer);
    payoutAdvanceTimer = null;
  }
}

function getCurrentPayoutCorrectValue() {
  return parseFloat(payoutInput.dataset.correct);
}

function getRandomBet() {
  return Math.floor(Math.random() * 50) + 1;
}

function formatTime(ms) {
  const totalHundredths = Math.floor(ms / 10);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function getSprintElapsedMs() {
  if (payoutState.sprint.timerRunning) {
    return payoutState.sprint.elapsedMs + (performance.now() - payoutState.sprint.timerStartedAt);
  }
  return payoutState.sprint.elapsedMs;
}

function updateSprintTimerDisplay() {
  payoutTimer.innerText = formatTime(getSprintElapsedMs());
}

function stopSprintTimerInterval() {
  if (window.__sprintTimerInterval) {
    clearInterval(window.__sprintTimerInterval);
    window.__sprintTimerInterval = null;
  }
}

function beginSprintTimerIfNeeded() {
  const sprint = payoutState.sprint;

  if (payoutMode !== 'sprint' || payoutLocked || sprint.completed) return;
  if (sprint.timerRunning) return;
  if (!payoutInput.value.trim()) return;

  sprint.hasStarted = true;
  sprint.timerRunning = true;
  sprint.timerStartedAt = performance.now();
  stopSprintTimerInterval();
  window.__sprintTimerInterval = setInterval(updateSprintTimerDisplay, 40);
  savePayoutState();
}

function pauseSprintTimerProgress() {
  const sprint = payoutState.sprint;

  if (sprint.timerRunning) {
    sprint.elapsedMs += performance.now() - sprint.timerStartedAt;
    sprint.timerRunning = false;
    sprint.timerStartedAt = 0;
  }

  stopSprintTimerInterval();
  updateSprintTimerDisplay();
  savePayoutState();
}

function setPayoutQuestion(bet, restoreValue = '') {
  payoutBet.innerText = bet;
  payoutInput.dataset.correct = (bet * 1.5).toFixed(2);
  payoutInput.value = restoreValue;
  payoutInput.disabled = payoutLocked;

  if (isPayoutVisible()) {
    setTimeout(() => payoutInput.focus(), 0);
  }
}

function setPayoutFeedback(text = '', type = '') {
  payoutFeedback.innerText = text;
  payoutFeedback.style.color =
    type === 'success'
      ? 'var(--success)'
      : type === 'error'
        ? 'var(--danger)'
        : 'var(--text)';
}

function triggerPayoutError(message = '') {
  payoutInput.classList.remove('error-shake');
  void payoutInput.offsetWidth;
  payoutInput.classList.add('error-shake');
  setPayoutFeedback(message, 'error');
}

function clearPayoutFeedback() {
  payoutInput.classList.remove('error-shake');
  setPayoutFeedback('', '');
}

function updateRandomUI() {
  const random = payoutState.random;

  payoutWidget.classList.add('random-mode');
  payoutWidget.classList.remove('sprint-mode');
  payoutDescription.innerText = 'Enter the correct 3:2 payout for the bet below.';
  randomCurrentStreakEl.innerText = random.currentStreak;
  randomBestStreakEl.innerText = random.bestStreak;
  payoutLocked = Boolean(random.pendingAdvance);
  setPayoutQuestion(random.currentBet, random.inputValue);
  payoutInput.disabled = payoutLocked;
  setPayoutFeedback(random.feedback, random.pendingFeedbackType || '');
}

function updateSprintUI() {
  const sprint = payoutState.sprint;

  payoutWidget.classList.remove('random-mode');
  payoutWidget.classList.add('sprint-mode');
  payoutDescription.innerText = 'Answer every payout from $1 to $50 in order as fast as you can.';
  payoutProgress.innerText = `${Math.min(sprint.progress + 1, 50)} / 50`;
  sprintCurrentStreakEl.innerText = sprint.currentStreak;
  sprintBestStreakEl.innerText = sprint.bestStreak;
  updateSprintTimerDisplay();
  payoutLocked = false;
  setPayoutQuestion(sprint.currentBet, sprint.inputValue);
  payoutInput.disabled = sprint.completed;
  setPayoutFeedback(sprint.feedback, sprint.completed ? 'success' : '');
}

function renderPayoutMode() {
  payoutModeRandomBtn.classList.toggle('active', payoutMode === 'random');
  payoutModeSprintBtn.classList.toggle('active', payoutMode === 'sprint');

  if (payoutMode === 'random') {
    updateRandomUI();
  } else {
    updateSprintUI();
  }
}

function savePayoutState() {
  const sprint = payoutState.sprint;
  const payload = {
    payoutMode,
    random: {
      ...payoutState.random
    },
    sprint: {
      ...sprint,
      elapsedMs: Math.round(getSprintElapsedMs()),
      timerRunning: false,
      timerStartedAt: 0
    }
  };

  safeLocalStorageSet(STORAGE_KEYS.payout, payload);
}

function restorePayoutState() {
  const state = safeLocalStorageGet(STORAGE_KEYS.payout);
  if (!state) return false;

  payoutMode = state.payoutMode === 'sprint' ? 'sprint' : 'random';

  Object.assign(payoutState.random, {
    currentBet: Number.isFinite(state.random?.currentBet) ? state.random.currentBet : 1,
    inputValue: state.random?.inputValue ?? '',
    feedback: state.random?.feedback ?? '',
    currentStreak: Number.isFinite(state.random?.currentStreak) ? state.random.currentStreak : 0,
    bestStreak: Number.isFinite(state.random?.bestStreak) ? state.random.bestStreak : 0,
    pendingAdvance: state.random?.pendingAdvance ?? null,
    pendingFeedbackType: state.random?.pendingFeedbackType ?? ''
  });

  Object.assign(payoutState.sprint, {
    currentBet: Number.isFinite(state.sprint?.currentBet) ? state.sprint.currentBet : 1,
    inputValue: state.sprint?.inputValue ?? '',
    feedback: state.sprint?.feedback ?? '',
    progress: Number.isFinite(state.sprint?.progress) ? state.sprint.progress : 0,
    currentStreak: Number.isFinite(state.sprint?.currentStreak) ? state.sprint.currentStreak : 0,
    bestStreak: Number.isFinite(state.sprint?.bestStreak) ? state.sprint.bestStreak : 0,
    elapsedMs: Number.isFinite(state.sprint?.elapsedMs) ? state.sprint.elapsedMs : 0,
    timerRunning: false,
    timerStartedAt: 0,
    hasStarted: Boolean(state.sprint?.hasStarted),
    completed: Boolean(state.sprint?.completed)
  });

  if (!payoutState.random.currentBet) payoutState.random.currentBet = getRandomBet();
  if (!payoutState.sprint.currentBet) payoutState.sprint.currentBet = 1;

  renderPayoutMode();
  return true;
}

function initDefaultPayoutState() {
  payoutMode = 'random';
  payoutState.random.currentBet = getRandomBet();
  payoutState.random.inputValue = '';
  payoutState.random.feedback = '';
  payoutState.random.currentStreak = 0;
  payoutState.random.bestStreak = 0;
  payoutState.random.pendingAdvance = null;
  payoutState.random.pendingFeedbackType = '';

  payoutState.sprint.currentBet = 1;
  payoutState.sprint.inputValue = '';
  payoutState.sprint.feedback = '';
  payoutState.sprint.progress = 0;
  payoutState.sprint.currentStreak = 0;
  payoutState.sprint.bestStreak = 0;
  payoutState.sprint.elapsedMs = 0;
  payoutState.sprint.timerRunning = false;
  payoutState.sprint.timerStartedAt = 0;
  payoutState.sprint.hasStarted = false;
  payoutState.sprint.completed = false;

  renderPayoutMode();
  savePayoutState();
}

function completePendingRandomAdvance() {
  const random = payoutState.random;
  random.pendingAdvance = null;
  random.pendingFeedbackType = '';
  random.feedback = '';
  random.inputValue = '';
  random.currentBet = getRandomBet();
  payoutLocked = false;
  renderPayoutMode();
  savePayoutState();
}

function scheduleRandomAdvance(delay) {
  const random = payoutState.random;
  cancelPayoutAdvanceTimer();
  random.pendingAdvance = { delay };
  savePayoutState();

  if (activeTab !== 'payout' || payoutMode !== 'random') return;

  payoutAdvanceTimer = setTimeout(() => {
    completePendingRandomAdvance();
  }, delay);
}

function setPayoutMode(mode) {
  if (mode === payoutMode) {
    if (mode === 'sprint') {
      pauseSprintTimerProgress();
      payoutState.sprint.currentBet = 1;
      payoutState.sprint.inputValue = '';
      payoutState.sprint.feedback = '';
      payoutState.sprint.progress = 0;
      payoutState.sprint.currentStreak = 0;
      payoutState.sprint.elapsedMs = 0;
      payoutState.sprint.timerRunning = false;
      payoutState.sprint.timerStartedAt = 0;
      payoutState.sprint.hasStarted = false;
      payoutState.sprint.completed = false;
    }

    if (mode === 'random') {
      cancelPayoutAdvanceTimer();
      payoutState.random.pendingAdvance = null;
      payoutState.random.pendingFeedbackType = '';
      payoutState.random.feedback = '';
      payoutState.random.inputValue = '';
      payoutState.random.currentStreak = 0;
      payoutState.random.currentBet = getRandomBet();
    }

    renderPayoutMode();
    savePayoutState();
    return;
  }

  if (payoutMode === 'sprint') {
    pauseSprintTimerProgress();
  }

  cancelPayoutAdvanceTimer();
  payoutMode = mode;
  renderPayoutMode();
  savePayoutState();
}

function isAutoSubmittableExact(rawValue, correct) {
  if (!rawValue || rawValue.endsWith('.')) return false;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return false;
  return Math.abs(parsed - correct) < 0.01;
}

function handleRandomAnswer() {
  if (payoutLocked || payoutMode !== 'random') return;

  const random = payoutState.random;
  const raw = payoutInput.value.trim();
  if (!raw) return;

  random.inputValue = raw;
  const val = parseFloat(raw);
  const correct = getCurrentPayoutCorrectValue();

  if (Math.abs(val - correct) < 0.01) {
    payoutLocked = true;
    random.currentStreak += 1;
    if (random.currentStreak > random.bestStreak) {
      random.bestStreak = random.currentStreak;
    }
    random.feedback = '✅ CORRECT';
    random.pendingFeedbackType = 'success';
    triggerSuccessEffect(payoutWidget, payoutInput);
    renderPayoutMode();
    scheduleRandomAdvance(500);
  } else {
    payoutLocked = true;
    random.currentStreak = 0;
    random.feedback = `❌ WRONG. $${payoutBet.innerText} pays $${correct.toFixed(2)}`;
    random.pendingFeedbackType = 'error';
    renderPayoutMode();
    triggerPayoutError(random.feedback);
    scheduleRandomAdvance(1500);
  }
}

function handleSprintAnswer() {
  if (payoutLocked || payoutMode !== 'sprint' || payoutState.sprint.completed) return;

  const sprint = payoutState.sprint;
  const raw = payoutInput.value.trim();
  if (!raw) return;

  sprint.inputValue = raw;
  beginSprintTimerIfNeeded();

  const val = parseFloat(raw);
  const correct = getCurrentPayoutCorrectValue();

  if (Math.abs(val - correct) < 0.01) {
    sprint.progress += 1;
    sprint.currentStreak += 1;
    if (sprint.currentStreak > sprint.bestStreak) {
      sprint.bestStreak = sprint.currentStreak;
    }

    triggerSuccessEffect(payoutWidget, payoutInput);

    if (sprint.progress >= 50) {
      pauseSprintTimerProgress();
      sprint.completed = true;
      sprint.feedback = `🏁 Finished in ${formatTime(sprint.elapsedMs)}`;
      sprint.inputValue = '';
      renderPayoutMode();
      savePayoutState();
      return;
    }

    sprint.currentBet += 1;
    sprint.inputValue = '';
    sprint.feedback = '';
    renderPayoutMode();
    savePayoutState();
  } else {
    sprint.currentStreak = 0;
    renderPayoutMode();
    triggerPayoutError('Try again');
    sprint.feedback = 'Try again';
    savePayoutState();
  }
}

function maybeAutoSubmitPayout() {
  if (payoutLocked || payoutInput.disabled) return;

  if (payoutMode === 'random') {
    payoutState.random.inputValue = payoutInput.value;
  } else {
    payoutState.sprint.inputValue = payoutInput.value;
    beginSprintTimerIfNeeded();
  }

  savePayoutState();

  const raw = payoutInput.value.trim();
  const correct = getCurrentPayoutCorrectValue();

  if (!isAutoSubmittableExact(raw, correct)) return;

  if (payoutMode === 'random') {
    handleRandomAnswer();
  } else {
    handleSprintAnswer();
  }
}

payoutInput.addEventListener('input', maybeAutoSubmitPayout);

payoutInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;

  if (payoutMode === 'sprint') {
    beginSprintTimerIfNeeded();
    handleSprintAnswer();
  } else {
    handleRandomAnswer();
  }
});

function switchTab(mode) {
  if (mode === activeTab) return;

  if (activeTab === 'game') {
    pauseGame();
  }

  if (activeTab === 'payout') {
    pauseSprintTimerProgress();
    cancelPayoutAdvanceTimer();
    savePayoutState();
  }

  activeTab = mode;
  saveAppState();
  updateCenterConsoleVisibility();

  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.remove('active');
  });

  document.getElementById(`tab-${mode}`).classList.add('active');

  if (mode === 'game') {
    document.getElementById('payout-mode').style.display = 'none';
    document.getElementById('game-mode').style.display = 'grid';
    renderTable();
    resumeGame();
  } else {
    hud.classList.add('hud-hidden');
    document.getElementById('game-mode').style.display = 'none';
    document.getElementById('payout-mode').style.display = 'grid';
    renderPayoutMode();
    updatePayoutFitScale();
  }
}

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

window.addEventListener('resize', () => {
  updateTableScale();
  updatePayoutFitScale();
});

window.addEventListener('orientationchange', () => {
  updateTableScale();
  updatePayoutFitScale();
});

window.addEventListener('beforeunload', () => {
  pauseGame();
  pauseSprintTimerProgress();
  cancelPayoutAdvanceTimer();
  savePayoutState();
  saveAppState();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseGame();
    pauseSprintTimerProgress();
    cancelPayoutAdvanceTimer();
    savePayoutState();
  } else {
    if (activeTab === 'game') {
      resumeGame();
    } else {
      renderPayoutMode();
    }
  }
});

window.addEventListener('load', () => {
  loadAppState();

  const restoredGame = restoreGameState();
  const restoredPayout = restorePayoutState();

  if (!restoredGame) {
    buildDeck();
    renderTable();
    saveGameState();
  }

  if (!restoredPayout) {
    initDefaultPayoutState();
  }

  updateTableScale();
  updateCenterConsoleVisibility();
  updatePayoutFitScale();

  document.getElementById('game-mode').style.display = activeTab === 'game' ? 'grid' : 'none';
  document.getElementById('payout-mode').style.display = activeTab === 'payout' ? 'grid' : 'none';
  document.getElementById('tab-game').classList.toggle('active', activeTab === 'game');
  document.getElementById('tab-payout').classList.toggle('active', activeTab === 'payout');

  if (activeTab === 'game') {
    resumeGame();
  } else {
    renderPayoutMode();
  }
});

if ('ResizeObserver' in window) {
  const resizeObserver = new ResizeObserver(() => {
    updateTableScale();
    updatePayoutFitScale();
  });

  window.addEventListener('load', () => {
    const tableShell = document.getElementById('table-shell');
    if (tableShell) resizeObserver.observe(tableShell);
    if (payoutModeEl) resizeObserver.observe(payoutModeEl);
    if (payoutWidget) resizeObserver.observe(payoutWidget);
  });
}
