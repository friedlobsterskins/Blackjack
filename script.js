(() => {
  'use strict';
  const E = window.CasinoEngine;
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'clubRoyaleCasino.v1';
  const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const cash = value => currency.format(value);
  const compact = value => '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + cash(Math.abs(value));
  const cents = value => Math.round(value * 100) / 100;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const delay = ms => new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? 0 : ms));
  const fresh = () => ({ version: 1, balance: 10000, game: 'blackjack', bets: { blackjack: 25, ultimate: 25, trips: 0 }, net: 0, hands: 0, history: [], shoe: [], round: null, sound: false });
  let state = load();
  let busy = false;
  let view = null;
  let audioContext;
  let toastTimer;
  let storageWarned = false;
  let selectedChip = 25;
  let undoBets = [];
  let lastChipZone = '';

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || saved.version !== 1 || !['blackjack','ultimate'].includes(saved.game) ||
          !Number.isFinite(saved.balance) || saved.balance < 0 || !Number.isFinite(saved.net) ||
          !Number.isInteger(saved.hands) || !saved.bets || !Array.isArray(saved.history) || !Array.isArray(saved.shoe)) return fresh();
      if (saved.round && (saved.round.game !== saved.game || !Array.isArray(saved.round.dealer) ||
          !['insurance','player','preflop','flop','river','settled'].includes(saved.round.phase))) return fresh();
      if (saved.round?.game === 'blackjack') saved.shoe = saved.round.shoe;
      saved.history = saved.history.slice(0, 50);
      saved.bets.blackjack = validStoredBet(saved.bets.blackjack, 2000);
      saved.bets.ultimate = validStoredBet(saved.bets.ultimate, 2000);
      saved.bets.trips = Number.isInteger(saved.bets.trips) && saved.bets.trips >= 0 && saved.bets.trips <= 100 && saved.bets.trips % 5 === 0 ? saved.bets.trips : 0;
      return saved;
    } catch { return fresh(); }
  }

  function validStoredBet(value, max) {
    return Number.isInteger(value) && value >= 0 && value <= max && value % 5 === 0 ? value : 25;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch {
      if (!storageWarned) {
        storageWarned = true;
        toast('Browser storage is unavailable. This session will last until you close or refresh the page.');
      }
    }
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4300);
  }

  function sound(type = 'card') {
    if (!state.sound) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audioContext ||= new Audio();
      if (audioContext.state === 'suspended') void audioContext.resume();
      const playTone = (frequency, start, length, volume) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = type === 'card' ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(.001, start + length);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + length);
      };
      const time = audioContext.currentTime;
      if (type === 'win') [523,659,784].forEach((note, i) => playTone(note,time + i * .10,.3,.06));
      else playTone(type === 'chip' ? 1000 : 240,time,.085,.035);
    } catch { /* Audio is optional. */ }
  }

  const active = () => Boolean(state.round && state.round.phase !== 'settled');
  const locked = () => busy || active();
  const ultimate = () => state.game === 'ultimate';
  const maxBet = () => 2000;
  const bet = () => Number($('bet-input').value);
  const trips = () => ultimate() ? Number($('trips-input').value) : 0;

  function betError() {
    const amount = bet();
    const side = trips();
    if (amount === 0) return ultimate() ? 'Select a chip, then click Ante or Blind to place your opening bets.' : 'Select a chip, then click the betting circle to place your bet.';
    if (!Number.isInteger(amount) || amount < 25 || amount > maxBet() || amount % 5 !== 0) return 'Choose a bet from $25 to ' + compact(maxBet()) + ', in $5 increments.';
    if (!Number.isInteger(side) || side < 0 || side > 100 || side % 5 !== 0) return 'Trips must be $0–$100 in $5 increments.';
    const required = ultimate() ? amount * 3 + side : amount;
    if (state.balance < required) return ultimate() ? 'You need Ante + Blind + at least 1× Ante for Play. Lower your bet or add free chips.' : 'Not enough chips. Lower your bet or add free chips.';
    return '';
  }

  function syncInputs() {
    $('bet-input').value = state.bets[state.game];
    $('trips-input').value = state.bets.trips;
  }

  function updateBetting() {
    const isLocked = locked();
    const amount = Number.isFinite(bet()) ? bet() : 0;
    $('bet-input').max = maxBet();
    $('bet-label').textContent = ultimate() ? 'YOUR ANTE' : 'YOUR BET';
    $('bet-range').textContent = '$25 – ' + compact(maxBet());
    $('poker-bets').hidden = !ultimate();
    $('blind-bet').textContent = compact(amount);
    $('wager-label').textContent = state.round ? finalVisible() ? 'LAST WAGER' : 'ON THE TABLE' : 'ON THE TABLE';
    $('wager-total').textContent = cash(state.round ? state.round.wagered : ultimate() ? amount * 2 + trips() : amount);
    $('betting-title').textContent = isLocked ? 'You’re at the table' : 'Place your bet';
    document.querySelectorAll('[data-chip], [data-adjust], #bet-input, #trips-input').forEach(el => { el.disabled = isLocked; });
    document.querySelectorAll('[data-action="clear"], [data-action="repeat"], [data-action="bet"]').forEach(el => { el.disabled = isLocked; });
    document.querySelectorAll('[data-action="undo"]').forEach(el => { el.disabled = isLocked || !undoBets.length; });
    $('deal-btn').disabled = isLocked || Boolean(betError());
    $('deal-btn').hidden = isLocked;
    $('deal-btn').innerHTML = '<span>' + (busy ? 'Dealing…' : active() ? 'Hand in progress' : state.round ? 'Deal again' : 'Deal me in') + '</span><span aria-hidden="true">→</span>';
    $('bet-error').textContent = isLocked ? '' : betError();
    document.querySelectorAll('[data-game]').forEach(el => {
      el.disabled = isLocked && el.dataset.game !== state.game;
      el.title = el.disabled ? 'Finish your hand before changing tables.' : '';
    });
    $('bankroll-btn').disabled = isLocked;
  }

  function adjustBet(action, chip) {
    if (locked()) return;
    let value = bet() || 0;
    const available = Math.max(0, Math.floor((state.balance - trips()) / (ultimate() ? 6 : 1) / 5) * 5);
    if (chip) value += chip;
    else if (action === 'up') value += 5;
    else if (action === 'down') value -= 5;
    else if (action === 'half') value = Math.floor(value / 10) * 5;
    else if (action === 'twice') value *= 2;
    else if (action === 'max') value = Math.min(maxBet(), available);
    value = Math.max(0, Math.min(maxBet(), value));
    rememberBet();
    state.round = null;
    $('bet-input').value = value;
    state.bets[state.game] = value;
    save();
    sound('chip');
    render();
  }

  function cardHTML(card, options = {}) {
    const classes = ['card'];
    const fanPosition = options.fanIndex === undefined ? 0 : options.fanIndex - (options.fanCount - 1)/2;
    const fanAngle = fanPosition * Math.min(18, 38 / Math.max(1, (options.fanCount || 1)-1));
    const fanStyle = options.fanIndex === undefined ? '' : ' style="--fan-angle:' + fanAngle + 'deg;--fan-y:' + (-fanPosition*10) + 'px"';
    if (options.animate) classes.push('dealt');
    if (!card) return '<div class="card card-placeholder" aria-label="Empty card position"><span aria-hidden="true">♠</span></div>';
    if (options.hidden) return '<div class="' + classes.join(' ') + ' card-back" role="img" aria-label="Face-down card"></div>';
    if (card.suit === 'H' || card.suit === 'D') classes.push('red');
    if (['J','Q','K'].includes(card.rank)) classes.push('face-card');
    if (options.best) classes.push('best-card');
    const corner = '<span>' + escape(card.rank) + '</span><small>' + SUITS[card.suit] + '</small>';
    return '<div class="' + classes.join(' ') + '"' + fanStyle + ' role="img" aria-label="' + escape(card.rank + ' of ' + SUIT_NAMES[card.suit]) + '"><div class="card-corner" aria-hidden="true">' + corner + '</div><div class="card-center" aria-hidden="true">' + (['J','Q','K'].includes(card.rank) ? ({J:'♞',Q:'♛',K:'♚'}[card.rank]) : SUITS[card.suit]) + '</div><div class="card-corner bottom" aria-hidden="true">' + corner + '</div></div>';
  }

  function finalVisible() { return state.round?.phase === 'settled' && !busy; }
  function visibleBoardCount() {
    if (!state.round || !ultimate()) return 0;
    return view?.boardCount ?? ({ preflop: 0, flop: 3, river: 5, settled: 5 }[state.round.phase] || 0);
  }
  function playerCards(index, cards) {
    return cards.slice(0, view?.playerCounts?.[index] ?? cards.length);
  }
  function bestCard(card) {
    return finalVisible() && ultimate() && state.round.playerRank.cards.some(c => c.rank === card.rank && c.suit === card.suit);
  }
  function totalText(cards) {
    const value = E.blackjackValue(cards);
    return (value.soft ? 'Soft ' : '') + value.total;
  }

  function renderTable() {
    const r = state.round;
    const settled = finalVisible();
    $('table').className = 'table ' + (ultimate() ? 'ultimate-table' : 'blackjack-table');
    $('table-name').textContent = ultimate() ? 'ULTIMATE TEXAS HOLD’EM' : 'BLACKJACK';
    $('table-number').textContent = ultimate() ? 'TABLE 02' : 'TABLE 01';
    $('felt-brand').querySelector('.felt-brand-name').textContent = ultimate() ? 'Ultimate Texas Hold’em' : 'Blackjack';
    $('felt-limit').innerHTML = 'MIN $25 <span>·</span> MAX ' + compact(maxBet()) + (ultimate() ? ' ANTE' : '');
    $('community-zone').hidden = !ultimate();
    document.querySelectorAll('[data-game]').forEach(el => {
      el.classList.toggle('active', el.dataset.game === state.game);
      el.setAttribute('aria-pressed', String(el.dataset.game === state.game));
    });

    const dealerCount = r ? (view?.dealerCount ?? r.dealer.length) : 0;
    const reveal = view?.dealerReveal ?? settled;
    const visibleDealer = r ? r.dealer.slice(0, dealerCount) : [];
    $('dealer-hand').classList.toggle('many-cards', dealerCount > 4);
    $('dealer-hand').innerHTML = r ? visibleDealer.map((c,i) => cardHTML(c, { hidden: !reveal && (ultimate() || i > 0), animate: view?.newCard === 'd' + i })).join('') : cardHTML(null) + cardHTML(null);
    const shownDealer = !ultimate() ? visibleDealer.filter((_,i) => reveal || i === 0) : [];
    $('dealer-total').hidden = !shownDealer.length || ultimate();
    $('dealer-total').textContent = shownDealer.length ? totalText(shownDealer) : '';
    $('dealer-caption').textContent = !r ? 'Your next hand is waiting' : ultimate() ? (settled ? r.dealerRank.name + (r.qualifies ? ' · Dealer qualifies' : ' · Dealer does not qualify') : 'Dealer needs a pair to qualify') : settled ? (E.isBlackjack(r.dealer) ? 'Blackjack' : E.blackjackValue(r.dealer).total > 21 ? 'Dealer busts' : 'Dealer total: ' + totalText(r.dealer)) : reveal ? 'Dealer is playing' : 'Dealer hits soft 17';

    if (ultimate()) {
      const count = visibleBoardCount();
      $('community-hand').innerHTML = Array.from({length:5}, (_,i) => cardHTML(r && i < count ? r.board[i] : null, { best: r && i < count && bestCard(r.board[i]), animate: view?.newCard === 'b' + i })).join('');
      $('street-caption').textContent = !r ? 'Five cards. One best hand.' : count === 0 ? 'Your two cards. Your first decision.' : count === 3 ? 'The flop is on the table' : settled ? 'Your best five cards are highlighted' : 'The turn and river are on the table';
      const cards = r ? playerCards(0, r.player) : [];
      let rank = '';
      if (r && count >= 3) rank = E.evaluatePoker([...r.player, ...r.board.slice(0,count)]).name;
      const label = rank || (r ? 'YOUR HOLE CARDS' : 'YOUR HAND');
      const wagers = r ? [['ANTE',r.ante],['BLIND',r.blind],['PLAY',r.play], ...(r.trips ? [['TRIPS',r.trips]] : [])] : [['ANTE',bet()],['BLIND',bet()]];
      $('player-hands').className = 'player-hands';
      $('player-hands').innerHTML = '<div class="player-hand ' + (settled ? r.result === 'win' ? 'won' : r.result === 'lose' ? 'lost' : '' : r ? 'active' : '') + '"><div class="hand-title">' + escape(label) + '</div><div class="hand">' + (r ? cards.map((c,i) => cardHTML(c,{best:bestCard(c),animate:view?.newCard === 'p0-' + i,fanIndex:i,fanCount:cards.length})).join('') : cardHTML(null) + cardHTML(null)) + '</div><div class="poker-wagers">' + wagers.map(([name,value]) => '<div class="poker-wager"><small>' + name + '</small>' + compact(value) + '</div>').join('') + '</div></div>';
      $('player-caption').textContent = settled ? r.result === 'fold' ? 'Folded · Trips settled independently' : 'Best five of seven' : r ? 'Play against the dealer' : 'Make yourself at home.';
      $('shoe-info').textContent = 'Single deck · Fresh shuffle every hand';
    } else {
      const hands = r?.hands || [];
      $('player-hands').className = 'player-hands' + (hands.length > 1 ? ' split-hands' : '');
      $('player-hands').innerHTML = hands.length ? hands.map((hand,i) => {
        const cards = playerCards(i,hand.cards);
        const focused = !busy && r.phase === 'player' && i === r.activeHand;
        const result = settled ? ({ blackjack:'BLACKJACK', win:'WIN', lose:'LOSE', push:'PUSH', bust:'BUST' }[hand.result]) : hand.done && !busy ? (E.blackjackValue(hand.cards).total > 21 ? 'BUST' : 'STAND') : hands.length > 1 ? 'HAND ' + (i + 1) : 'YOUR HAND';
        return '<div class="player-hand ' + (focused ? 'active ' : '') + (settled ? hand.returned > hand.bet ? 'won' : hand.returned < hand.bet ? 'lost' : '' : '') + '"><div class="hand-title">' + result + (cards.length ? '<span class="total-badge">' + totalText(cards) + '</span>' : '') + '</div><div class="hand ' + (cards.length > 4 ? 'many-cards' : '') + '">' + cards.map((c,j) => cardHTML(c,{animate:view?.newCard === 'p' + i + '-' + j,fanIndex:j,fanCount:cards.length})).join('') + '</div><div class="bet-on-table">' + compact(hand.bet) + '</div></div>';
      }).join('') : '<div class="player-hand"><div class="hand-title">YOUR HAND</div><div class="hand">' + cardHTML(null) + cardHTML(null) + '</div><div class="bet-on-table">' + compact(bet() || 0) + '</div></div>';
      $('player-caption').textContent = !r ? 'Make yourself at home.' : r.hands.length > 1 && !settled ? 'Playing hand ' + (r.activeHand + 1) + ' of ' + r.hands.length : r.insurance.bet ? 'Insurance: ' + compact(r.insurance.bet) + (r.insurance.result ? ' · ' + (r.insurance.result === 'win' ? 'Won' : 'Lost') : '') : settled ? 'Your next hand is waiting' : 'The next move is yours';
      const remaining = r?.shoe?.length ?? state.shoe.length;
      $('shoe-info').textContent = remaining ? '6-deck shoe · ' + remaining + ' cards remaining' : '6-deck shoe · Shuffled and ready';
    }
  }

  function button(action,label,enabled=true,style='',note='') {
    return '<button class="action-button ' + style + '" data-action="' + action + '"' + (!enabled ? ' disabled' : '') + '>' + label + (note ? '<small>' + note + '</small>' : '') + '</button>';
  }

  function renderActions() {
    const r = state.round;
    let title = state.hands ? 'Welcome back to your seat.' : 'Pull up a chair. You’re in good company.';
    let detail = ultimate() ? 'Place equal Ante and Blind bets to begin.' : 'Choose your chips and place your bet.';
    let actions = '';
    let resultClass = '';
    if (busy) {
      title = view?.message || 'Dealing your cards…';
      detail = 'Let the cards do the talking.';
    } else if (!r || r.phase === 'settled') {
      if (r) {
        const net = cents(r.returned - r.wagered);
        title = net > 0 ? 'Nicely played. ' + cash(net) + ' is yours.' : net < 0 ? 'The house takes this one. −' + cash(-net) + '.' : 'Even honours. Your chips are back.';
        if (r.game === 'blackjack' && r.hands.length === 1 && r.hands[0].result === 'blackjack') title = 'Blackjack. ' + signed(net) + '.';
        if (r.game === 'ultimate' && r.result === 'fold') title = 'You folded. ' + signed(net) + '.';
        resultClass = net > 0 ? 'won' : net < 0 ? 'lost' : '';
        detail = cash(r.wagered) + ' wagered · ' + cash(r.returned) + ' returned';
        if (ultimate() && !r.qualifies && r.result !== 'fold') detail += ' · Ante pushes';
        actions += button('details','Details');
      }
      if (!r) detail = ultimate() ? 'Select a chip. Click Ante or Blind to bet; Trips is optional.' : 'Select a chip, then click the betting circle to add it.';
    } else if (r.phase === 'insurance') {
      title = 'Dealer shows an ace. Insurance?';
      detail = 'A side bet of ' + cash(r.initialBet/2) + ' pays 2:1 if the dealer has blackjack.';
      actions = button('decline','No thanks') + button('insurance','Insurance',E.blackjackActions(r,state.balance).includes('insurance'),'primary',compact(r.initialBet/2));
    } else if (r.game === 'blackjack') {
      const legal = E.blackjackActions(r,state.balance);
      title = r.hands.length > 1 ? 'Hand ' + (r.activeHand + 1) + '. Your move.' : 'Your move.';
      detail = 'You have ' + totalText(r.hands[r.activeHand].cards).toLowerCase() + '.';
      if (r.insurance.bet && r.insurance.result === 'lose') detail += ' Insurance lost.';
      actions = button('hit','Hit',legal.includes('hit'),'primary') + button('stand','Stand',legal.includes('stand')) + button('double','Double',legal.includes('double'),'','+' + compact(r.hands[r.activeHand].bet)) + button('split','Split',legal.includes('split'),'','+' + compact(r.hands[r.activeHand].bet));
    } else {
      const legal = E.ultimateActions(r,state.balance);
      if (r.phase === 'preflop') {
        title = 'Two cards. A little possibility.';
        detail = 'Raise 3× or 4× your ante, or check to see the flop.';
        actions = button('check','Check') + button('play3','Play 3×',legal.includes('play3'),'',compact(r.ante*3)) + button('play4','Play 4×',legal.includes('play4'),'primary',compact(r.ante*4));
      } else if (r.phase === 'flop') {
        title = 'There’s the flop. What do you think?';
        detail = 'Bet 2× your ante, or check to the turn and river.';
        actions = button('check','Check') + button('play2','Play 2×',legal.includes('play2'),'primary',compact(r.ante*2));
      } else {
        title = 'All the cards are out. Your call.';
        detail = 'Bet 1× your ante to face the dealer, or fold.';
        actions = button('fold','Fold',true,'danger') + button('play1','Play 1×',legal.includes('play1'),'primary',compact(r.ante));
      }
    }
    $('round-message').className = 'round-message ' + resultClass;
    $('round-message').innerHTML = '<span class="status-orb"></span><div><strong>' + escape(title) + '</strong><small>' + escape(detail) + '</small></div>';
    const focusedAction = document.activeElement?.dataset.action;
    $('game-actions').innerHTML = actions;
    if (focusedAction) {
      const focus = $('game-actions').querySelector('[data-action="' + focusedAction + '"]:not(:disabled)') || $('game-actions').querySelector('button:not(:disabled)');
      focus?.focus({preventScroll:true});
    }
  }

  function historyHTML(records) {
    return records.map(h => '<div class="history-row"><div class="history-label"><span class="history-icon" aria-hidden="true">' + (h.game === 'blackjack' ? '♠' : '♦') + '</span><span>' + (h.game === 'blackjack' ? 'Blackjack' : 'Ultimate Hold’em') + '<small>' + escape(h.label) + ' · ' + compact(h.wagered) + ' bet</small></span></div><strong class="' + (h.net > 0 ? 'positive' : h.net < 0 ? 'negative' : '') + '">' + signed(h.net) + '</strong></div>').join('');
  }

  function render() {
    // Keep results out of the display until the dealer's reveal finishes.
    const pending = busy && state.round?.phase === 'settled' && state.round.paid;
    const visibleNet = state.net - (pending ? cents(state.round.returned - state.round.wagered) : 0);
    const records = pending ? state.history.slice(1) : state.history;
    $('balance').textContent = cash(state.balance - (pending ? state.round.returned : 0));
    $('session-net').textContent = signed(visibleNet);
    $('session-net').className = visibleNet > 0 ? 'positive' : visibleNet < 0 ? 'negative' : '';
    $('session-hands').textContent = (state.hands - (pending ? 1 : 0)).toLocaleString();
    if ($('recent-hands')) $('recent-hands').innerHTML = records.length ? historyHTML(records.slice(0,3)) : '<div class="history-empty"><span aria-hidden="true">♧</span><p>A fresh deck. A fresh start.<small>Your hands will appear here.</small></p></div>';
    $('sound-btn').setAttribute('aria-pressed',String(Boolean(state.sound)));
    $('sound-btn').setAttribute('aria-label',state.sound ? 'Turn sound off' : 'Turn sound on');
    $('sound-btn').title = state.sound ? 'Turn sound off' : 'Turn sound on';
    $('sound-btn').classList.toggle('sound-on',Boolean(state.sound));
    $('sound-waves').setAttribute('d',state.sound ? 'M15 8c2 2 2 6 0 8m3-11c4 4 4 10 0 14' : 'm16 9 6 6m0-6-6 6');
    updateBetting();
    renderTable();
    renderActions();
    renderWagers();
    renderChipSelection();
  }

  // Debit, settlement, history and round state are saved together before visual
  // animation. A refresh resumes the round without charging or paying twice.
  function settleWallet() {
    const r = state.round;
    if (!r || r.phase !== 'settled' || r.paid) return;
    const net = cents(r.returned - r.wagered);
    state.balance = cents(state.balance + r.returned);
    state.net = cents(state.net + net);
    state.hands++;
    const label = r.game === 'blackjack' ? r.hands.length > 1 ? r.hands.length + ' split hands' : ({blackjack:'Blackjack',win:'Win',lose:'Loss',bust:'Bust',push:'Push'}[r.hands[0].result]) : r.result === 'fold' ? 'Fold' : r.playerRank.name;
    state.history.unshift({game:r.game,net,wagered:r.wagered,returned:r.returned,label,time:Date.now()});
    state.history = state.history.slice(0,50);
    r.paid = true;
  }

  async function animateSettlement() {
    const r = state.round;
    if (r.phase !== 'settled') return;
    view.message = ultimate() ? 'Let’s see the rest of the board…' : 'The dealer’s turn…';
    render();
    if (ultimate()) {
      for (let i = view.boardCount; i < 5; i++) {
        await delay(i === 3 ? 450 : 220);
        view.boardCount = i + 1;
        view.newCard = 'b' + i;
        sound();
        render();
      }
      await delay(450);
      view.dealerReveal = true;
      view.newCard = 'd1';
      view.message = 'Showdown.';
      sound();
      render();
      await delay(550);
    } else {
      await delay(430);
      view.dealerReveal = true;
      view.dealerCount = 2;
      view.newCard = 'd1';
      sound();
      render();
      for (let i = 2; i < r.dealer.length; i++) {
        await delay(470);
        view.dealerCount = i + 1;
        view.newCard = 'd' + i;
        sound();
        render();
      }
      await delay(450);
    }
    if (r.returned > r.wagered) sound('win');
  }

  async function deal() {
    if (locked()) return;
    const error = betError();
    if (error) { toast(error); return; }
    busy = true;
    try {
      state.bets[state.game] = bet();
      state.bets.trips = Number($('trips-input').value) || 0;
      state.lastBets ||= {};
      state.lastBets[state.game] = { bet: bet(), trips: trips() };
      undoBets = [];
      if (ultimate()) {
        state.round = E.createUltimate(bet(),trips());
      } else {
        if (state.shoe.length < 80) state.shoe = E.makeDeck(6);
        state.round = E.createBlackjack(bet(),state.shoe);
        state.shoe = state.round.shoe;
      }
      state.balance = cents(state.balance - state.round.wagered);
      settleWallet();
      save();
      view = { playerCounts:[0], dealerCount:0, dealerReveal:false, boardCount:0, message:'Dealing your cards…', newCard:'' };
      render();
      for (const [who,count] of [['p',1],['d',1],['p',2],['d',2]]) {
        await delay(190);
        if (who === 'p') view.playerCounts[0] = count;
        else view.dealerCount = count;
        view.newCard = who === 'p' ? 'p0-' + (count-1) : 'd' + (count-1);
        sound();
        render();
      }
      await delay(230);
      await animateSettlement();
    } catch (error) { toast(error.message); }
    finally { busy = false; view = null; render(); focusActions(); }
  }

  async function act(action) {
    if (busy || !active()) return;
    busy = true;
    const r = state.round;
    const priorBoard = visibleBoardCount();
    const previousCounts = ultimate() ? [r.player.length] : r.hands.map(h => h.cards.length);
    view = { playerCounts:previousCounts.slice(), dealerCount:2, dealerReveal:false, boardCount:priorBoard, newCard:'', message:action === 'check' ? 'Checking…' : action === 'insurance' || action === 'decline' ? 'Dealer checks for blackjack…' : action === 'stand' ? 'Standing.' : action === 'fold' ? 'You fold. Settling your wagers…' : 'Making your play…' };
    try {
      const result = ultimate() ? E.actUltimate(r,action,state.balance) : E.actBlackjack(r,action,state.balance);
      state.balance = cents(state.balance - result.cost);
      if (!ultimate()) state.shoe = r.shoe;
      settleWallet();
      save();
      render();
      await delay(220);
      if (!ultimate()) {
        view.playerCounts = r.hands.map(h => h.cards.length);
        const i = action === 'split' ? r.activeHand : previousCounts.findIndex((n,i) => r.hands[i]?.cards.length > n);
        if (i >= 0) { view.newCard = 'p' + i + '-' + (r.hands[i].cards.length - 1); sound(); }
        render();
        await delay(200);
      } else if (r.phase !== 'settled') {
        const target = r.phase === 'flop' ? 3 : 5;
        for (let i = priorBoard; i < target; i++) {
          await delay(170);
          view.boardCount = i + 1;
          view.newCard = 'b' + i;
          sound();
          render();
        }
      }
      await animateSettlement();
    } catch (error) { toast(error.message); }
    finally { busy = false; view = null; render(); focusActions(); }
  }

  function focusActions() {
    if (!$('info-dialog').open && !$('bet-dialog').open) {
      const target = $('game-actions').querySelector('.primary:not(:disabled),button:not(:disabled)');
      if (target) target.focus({preventScroll:true});
      else if (!$('deal-btn').disabled) $('deal-btn').focus({preventScroll:true});
    }
  }

  const CHIP_COLORS = { 5:'#ab5549', 25:'#4c865b', 50:'#3c7182', 100:'#313b36', 500:'#8c6da1' };

  function rememberBet() {
    undoBets.push({ bet: bet(), trips: Number($('trips-input').value) || 0 });
    if (undoBets.length > 30) undoBets.shift();
  }

  function setOpeningBets(amount, side) {
    state.round = null;
    state.bets[state.game] = amount;
    state.bets.trips = side;
    syncInputs();
    save();
    render();
  }

  function selectChip(amount) {
    if (locked()) return;
    selectedChip = amount;
    renderChipSelection();
    sound('chip');
  }

  function renderChipSelection() {
    document.querySelectorAll('[data-chip]').forEach(el => {
      const selected = Number(el.dataset.chip) === selectedChip;
      el.classList.toggle('selected', selected);
      el.setAttribute('aria-pressed', String(selected));
    });
    $('selected-chip-label').textContent = compact(selectedChip) + ' selected';
    $('chip-instruction').textContent = locked() ? 'YOUR CHIPS ARE IN PLAY.' : 'SELECT A CHIP. CLICK A CIRCLE.';
  }

  function chipStack(amount) {
    if (!amount) return '';
    let remaining = amount;
    const piles = [];
    for (const denomination of [500,100,50,25,5]) {
      const count = Math.floor(remaining / denomination);
      if (count) { piles.push({ denomination, count }); remaining = cents(remaining - count * denomination); }
    }
    if (remaining) piles.push({ denomination: remaining, count: 1 });
    return '<span class="coin-group" aria-hidden="true">' + piles.slice(0,3).map(pile => '<span class="coin-pile">' + Array.from({length:Math.min(pile.count,4)},(_,i) => '<span class="table-chip" style="--chip-color:' + (CHIP_COLORS[pile.denomination] || '#94794c') + ';--level:' + i + '"><span>' + compact(pile.denomination) + '</span></span>').join('') + '</span>').join('') + '</span>';
  }

  function wagerCircle(zone, label, amount, options = {}) {
    const result = finalVisible() ? options.result : '';
    const outcome = result === 'win' || result === 'blackjack' ? 'win' : result === 'lose' || result === 'bust' ? 'lose' : result === 'push' ? 'push' : '';
    const enabled = options.enabled ?? !locked();
    const hint = options.hint || (enabled ? 'Add ' + compact(selectedChip) + ' to ' + label : label + ' is locked for this hand');
    return '<button class="wager-zone ' + (options.className || '') + (outcome ? ' zone-' + outcome : '') + (lastChipZone === zone ? ' zone-pop' : '') + '" data-zone="' + zone + '" aria-label="' + escape(label + ', ' + compact(amount) + '. ' + hint) + '" title="' + escape(hint) + '"' + (enabled ? '' : ' disabled') + '><span class="zone-label">' + label + '</span><span class="zone-oval"></span>' + (amount ? chipStack(amount) : '<span class="zone-empty">' + (zone === 'play' ? '<span class="zone-hint">' + (active() ? 'PLAY' : 'AFTER DEAL') + '</span>' : '+') + '</span>') + '<span class="zone-value">' + (amount ? compact(amount) : zone === 'trips' ? 'OPTIONAL' : zone === 'play' ? 'PLAY BET' : 'PLACE BET') + '</span></button>';
  }

  function renderWagers() {
    const r = state.round;
    if (ultimate()) {
      const played = r?.play || 0;
      const amounts = { ante:r?.ante ?? bet(), blind:r?.blind ?? bet(), trips:r?.trips ?? trips(), play:played };
      const result = name => r?.breakdown?.find(item => item.label.toLowerCase() === name)?.result;
      $('betting-spots').innerHTML = ['trips','ante','blind','play'].map(zone => wagerCircle(zone,zone.toUpperCase(),amounts[zone],{
        className:'poker-spot spot-' + zone,
        result:result(zone),
        enabled:zone === 'play' ? !busy && active() && !played && E.ultimateActions(r,state.balance).some(action=>action.startsWith('play')) : !locked(),
        hint:zone === 'play' ? 'Make your Play bet using the available raise options.' : zone === 'trips' ? 'Add a Trips side bet. It pays independently of the dealer.' : 'Ante and Blind always match. Each click adds a chip to both.'
      })).join('') + '<span class="bet-equals" aria-hidden="true">=</span>';
      $('felt-brand').querySelector('.felt-payout').textContent = 'DEALER QUALIFIES WITH A PAIR OR BETTER';
      $('table-paytable').innerHTML = '<h3>THE PAY TABLE</h3><table><thead><tr><th>Your hand</th><th>Blind</th><th>Trips</th></tr></thead><tbody>' + [['Royal flush','500:1','50:1'],['Straight flush','50:1','40:1'],['Four of a kind','10:1','30:1'],['Full house','3:1','8:1'],['Flush','3:2','7:1'],['Straight','1:1','4:1'],['Three of a kind','Push','3:1']].map(row => '<tr>' + row.map(cell=>'<td>'+cell+'</td>').join('') + '</tr>').join('') + '</tbody></table><p>BLIND: MUST BEAT THE DEALER<br>TRIPS: PAYS EVEN IF YOU FOLD</p>';
    } else {
      const hands = r?.hands || [{bet:bet()}];
      $('betting-spots').innerHTML = '<div class="blackjack-bets ' + (hands.length > 1 ? 'split-bets' : '') + '">' + hands.map((h,i) => '<div class="spot-wrap">' + wagerCircle('blackjack',hands.length > 1 ? 'HAND ' + (i+1) : 'YOUR BET',h.bet,{result:h.result,enabled:!locked()}) + '</div>').join('') + '</div>' + (r && (r.phase === 'insurance' || r.insurance.bet) ? wagerCircle('insurance','INSURANCE',r.insurance.bet,{className:'spot-insurance',result:r.insurance.result,enabled:!busy && r.phase === 'insurance' && E.blackjackActions(r,state.balance).includes('insurance'),hint:'Insure for half the original bet. Pays 2:1 on dealer blackjack.'}) : '');
      $('felt-brand').querySelector('.felt-payout').textContent = 'BLACKJACK PAYS 3 TO 2';
      $('table-paytable').innerHTML = '<h3>AT THIS TABLE</h3><table><tbody><tr><td>Blackjack</td><td>3:2</td></tr><tr><td>Win</td><td>1:1</td></tr><tr><td>Insurance</td><td>2:1</td></tr><tr><td>Equal totals</td><td>Push</td></tr></tbody></table><p>6 DECKS · DEALER HITS SOFT 17<br>DOUBLE AFTER SPLIT ALLOWED</p>';
    }
    const net = finalVisible() ? r.returned-r.wagered : 0;
    $('table').classList.toggle('result-win',net>0);
    $('table').classList.toggle('result-loss',net<0);
    lastChipZone = '';
  }

  function flyChip(zone) {
    if (reducedMotion.matches) return;
    const source = document.querySelector('[data-chip="' + selectedChip + '"]');
    const target = document.querySelector('[data-zone="' + zone + '"]');
    if (!source || !target) return;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const chip = document.createElement('span');
    chip.className = 'flying-chip';
    chip.style.left = (from.left + from.width/2 - 21) + 'px';
    chip.style.top = (from.top + from.height/2 - 21) + 'px';
    chip.innerHTML = '<span class="table-chip" style="--chip-color:' + CHIP_COLORS[selectedChip] + '"><span>' + compact(selectedChip) + '</span></span>';
    document.body.append(chip);
    const dx = to.left+to.width/2-from.left-from.width/2;
    const dy = to.top+to.height/2-from.top-from.height/2;
    const animation = chip.animate([{transform:'translate(0,0) rotate(0)'},{transform:'translate('+dx+'px,'+dy+'px) rotate(25deg)'}],{duration:320,easing:'cubic-bezier(.2,.7,.3,1)'});
    animation.onfinish = () => chip.remove();
    animation.oncancel = () => chip.remove();
  }

  function placeChip(zone, remove = false) {
    if (zone === 'play') {
      if (busy || !active() || !ultimate()) return;
      if (state.round.phase === 'flop') { void act('play2'); return; }
      if (state.round.phase === 'river') { void act('play1'); return; }
      toast('Choose Play 3× or Play 4× on the control rail.');
      focusActions();
      return;
    }
    if (zone === 'insurance') { if (!busy) void act('insurance'); return; }
    if (locked()) return;
    const isTrips = zone === 'trips';
    const amount = (isTrips ? trips() : bet()) + (remove ? -selectedChip : selectedChip);
    if (amount < 0) { toast('This circle has fewer chips than the selected denomination. Use Clear or Edit amount.'); return; }
    if (amount > (isTrips ? 100 : maxBet())) { toast((isTrips ? 'Trips' : ultimate() ? 'Ante / Blind' : 'This table') + ' has a ' + compact(isTrips ? 100 : maxBet()) + ' limit. Select a smaller chip.'); return; }
    const nextBet = isTrips ? bet() : amount;
    const nextTrips = isTrips ? amount : Number($('trips-input').value)||0;
    const required = ultimate() ? nextBet*3+nextTrips : nextBet;
    if (required > state.balance) { toast('Not enough chips for that bet' + (ultimate() ? ' and the minimum Play.' : '.') + ' Add free chips with +.'); return; }
    rememberBet();
    lastChipZone = zone;
    setOpeningBets(nextBet,nextTrips);
    sound('chip');
    if (!remove) { flyChip(zone); if (ultimate() && !isTrips) flyChip(zone === 'ante' ? 'blind' : 'ante'); }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('Your browser does not support fullscreen here. The table still fits your window.');
    } catch { toast('Fullscreen could not open. You can keep playing in this window.'); }
  }

  function syncFullscreen() {
    const isFullscreen = Boolean(document.fullscreenElement);
    $('fullscreen-btn').setAttribute('aria-pressed',String(isFullscreen));
    $('fullscreen-btn').setAttribute('aria-label',isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    $('fullscreen-btn').title = isFullscreen ? 'Exit fullscreen · Esc' : 'Enter fullscreen';
    $('fullscreen-btn').querySelector('span').textContent = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
    $('fullscreen-hint').textContent = isFullscreen ? 'Press Esc to leave fullscreen' : 'Your seat. Your pace.';
  }

  function switchGame(game) {
    if (locked()) { toast('Finish this hand before changing tables.'); return; }
    if (game === state.game) return;
    state.game = game;
    state.round = null;
    undoBets = [];
    // All main tables accept chips up to the $2,000 opening limit.
    view = null;
    syncInputs();
    save();
    render();
  }

  const blackjackRules = '<p class="rules-intro">Beat the dealer’s total without going over 21. You play every hand, and the dealer follows the posted table rules.</p><h3>This table</h3><ul><li>Six decks. Dealer hits soft 17 and stands on hard 17 or higher. The shoe is shuffled between rounds when fewer than 80 cards remain.</li><li>A natural blackjack (an ace and a ten-value card) pays <b>3:2</b>. Other wins pay <b>1:1</b>. Equal totals push and return your bet. Busts lose even if the dealer later busts.</li><li>Double on any first two cards, including after a split. Add an equal bet and receive exactly one more card.</li><li>Split two cards of equal value into two hands. Up to four hands are allowed. Each new hand requires an equal bet.</li><li>Split aces receive one card each, cannot be hit or resplit, and a 21 after any split pays 1:1.</li><li>The dealer checks for blackjack with an ace or ten-value upcard. With an ace showing, insurance is offered first for half your original bet and pays 2:1 if the dealer has blackjack.</li><li>No surrender. Bets $25–$2,000 in $5 increments; extra split, double, and insurance wagers may exceed the opening limit.</li></ul><p class="dialog-note">Casino rules vary. These are this table’s fixed rules. Reference: <a href="https://clearwatercasino.com/wp-content/rules/SixDeckBlackjackRules.pdf" target="_blank" rel="noopener noreferrer">Clearwater six-deck blackjack</a>. Keyboard: H hit, S stand, D double, P split, Enter deal when no hand is active.</p>';
  const pokerRules = '<p class="rules-intro">Ultimate Texas Hold’em is played against the dealer. Make the best five-card poker hand using any of your two hole cards and the five community cards.</p><h3>Make your play</h3><ol><li>Place equal <b>Ante</b> and <b>Blind</b> bets. Add an optional Trips bet before dealing.</li><li>With your two cards: check or bet <b>3× / 4× Ante</b> on Play.</li><li>After the three-card flop, if you checked: check again or bet <b>2× Ante</b>.</li><li>After the turn and river, if you still haven’t bet: <b>Play 1× Ante or fold</b>. You make only one Play bet per hand.</li></ol><h3>Showdown</h3><p>The dealer needs a pair or better to qualify. If the dealer doesn’t qualify, Ante pushes, including when your hand loses. Play and Blind still receive action. Otherwise a winning Ante pays 1:1. Winning Play pays 1:1. A tie returns all three main bets. Suits never break a tie. Folding loses Ante and Blind.</p><h3>Blind & Trips payouts</h3><table class="rules-table"><thead><tr><th>Best hand</th><th>Blind</th><th>Trips</th></tr></thead><tbody><tr><td>Royal flush</td><td>500:1</td><td>50:1</td></tr><tr><td>Straight flush</td><td>50:1</td><td>40:1</td></tr><tr><td>Four of a kind</td><td>10:1</td><td>30:1</td></tr><tr><td>Full house</td><td>3:1</td><td>8:1</td></tr><tr><td>Flush</td><td>3:2</td><td>7:1</td></tr><tr><td>Straight</td><td>1:1</td><td>4:1</td></tr><tr><td>Three of a kind</td><td>Push</td><td>3:1</td></tr><tr><td>Two pair or lower</td><td>Push</td><td>Lose</td></tr></tbody></table><p>Blind pays or pushes as shown <b>only when you beat the dealer</b>; it loses when you lose and pushes on a tie. Trips pays for three of a kind or better regardless of whether you win, lose, tie, or fold. All odds are profit; your winning stake is also returned.</p><p class="dialog-note">Ante and Blind: $25–$2,000 each. Optional Trips: $0–$100. Bets in $5 increments. Keep at least 1× Ante available for the final Play; keep 4× available to use every Play option. “Max” preserves 4× Ante. Fresh 52-card deck every hand. References: <a href="https://www.sycuan.com/wp-content/uploads/2024/09/Sycuan-Casino-Resort-Guide-To-Ultimate-Texas-Hold-Em.pdf" target="_blank" rel="noopener noreferrer">Sycuan rules and pay table</a> · <a href="https://oag.ca.gov/sites/all/files/agweb/pdfs/gambling/101-casino-utlimate-texas-hold-em-rules.pdf" target="_blank" rel="noopener noreferrer">California published game rules</a>.</p>';

  function showDialog(type) {
    let title = '';
    let kicker = 'THE HOUSE RULES';
    let html = '';
    if (type === 'rules') {
      title = ultimate() ? 'Ultimate Texas Hold’em' : 'Blackjack';
      html = ultimate() ? pokerRules : blackjackRules;
    } else if (type === 'history') {
      title = 'Your time at the tables';
      kicker = 'THE SESSION';
      const pending = busy && state.round?.phase === 'settled' && state.round.paid;
      const visibleNet = state.net - (pending ? cents(state.round.returned - state.round.wagered) : 0);
      const records = pending ? state.history.slice(1) : state.history;
      html = '<div class="result-summary">' + (state.hands - (pending ? 1 : 0)) + ' hands played · Net result <b class="' + (visibleNet > 0 ? 'positive' : visibleNet < 0 ? 'negative' : '') + '">' + signed(visibleNet) + '</b></div>' + (records.length ? historyHTML(records) : '<p>Your first hand is waiting. Place a bet to get started.</p>') + '<p class="dialog-note">Your latest 50 rounds are shown. Net result includes every round and excludes free chip refills. This session is saved in this browser.</p>';
    } else if (type === 'bankroll') {
      title = 'A little more to play with.';
      kicker = 'ON THE HOUSE';
      html = '<p>Keep your seat. Add free chips to your bankroll whenever you’re between hands.</p><div class="bankroll-amount">+$10,000</div><p>These chips are just for fun. They have no cash value, and there are no deposits or withdrawals.</p><div class="dialog-actions"><button class="primary-button" data-action="refill"' + (locked() ? ' disabled' : '') + '>Add free chips</button></div>' + (locked() ? '<p class="dialog-note">Finish your current hand first.</p>' : '');
    } else if (type === 'details') {
      const r = state.round;
      if (!r || r.phase !== 'settled' || busy) return;
      title = 'How your hand settled';
      kicker = 'THE RESULT';
      const lines = r.game === 'ultimate' ? r.breakdown.filter(b => b.bet > 0) : [...r.hands.map((h,i) => ({label:'Hand ' + (i+1),bet:h.bet,returned:h.returned,result:h.result})),...(r.insurance.bet ? [{label:'Insurance',...r.insurance}] : [])];
      html = '<div class="result-summary">Total wagered: ' + cash(r.wagered) + '<br>Total returned: ' + cash(r.returned) + '<br>Net result: <b>' + signed(cents(r.returned-r.wagered)) + '</b></div>' + (r.game === 'ultimate' ? '<p>Your hand: <b>' + r.playerRank.name + '</b><br>Dealer: <b>' + r.dealerRank.name + '</b> · ' + (r.qualifies ? 'Qualified' : 'Did not qualify') + '</p>' : '') + '<table class="rules-table"><thead><tr><th>Wager</th><th>Bet</th><th>Result</th><th>Returned</th></tr></thead><tbody>' + lines.map(line => '<tr><td>' + escape(line.label) + '</td><td>' + cash(line.bet) + '</td><td>' + escape(line.result) + '</td><td>' + cash(line.returned) + '</td></tr>').join('') + '</tbody></table><p class="dialog-note">“Returned” includes your stake on winning and pushed bets. Net result is the amount returned minus all wagers.</p>';
    }
    $('dialog-title').textContent = title;
    $('dialog-kicker').textContent = kicker;
    $('dialog-content').innerHTML = html;
    if (!$('info-dialog').open) $('info-dialog').showModal();
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    if (target.dataset.game) { switchGame(target.dataset.game); return; }
    if (target.dataset.open) { showDialog(target.dataset.open); return; }
    if (target.dataset.chip) { selectChip(Number(target.dataset.chip)); return; }
    if (target.dataset.zone) { placeChip(target.dataset.zone); return; }
    if (target.dataset.adjust) { adjustBet(target.dataset.adjust); return; }
    const action = target.dataset.action;
    if (action === 'deal') void deal();
    else if (action === 'details') showDialog('details');
    else if (action === 'bet') { if (!locked()) { $('bet-dialog').showModal(); $('bet-input').focus(); } }
    else if (action === 'clear') { if (!locked()) { rememberBet(); setOpeningBets(0,0); sound('chip'); } }
    else if (action === 'undo') { if (!locked() && undoBets.length) { const previous = undoBets.pop(); setOpeningBets(previous.bet,previous.trips); sound('chip'); } }
    else if (action === 'repeat') {
      if (locked()) return;
      const previous = state.lastBets?.[state.game] || (state.round ? {bet:state.round.initialBet || state.round.ante,trips:state.round.trips || 0} : {bet:25,trips:0});
      rememberBet(); setOpeningBets(previous.bet,previous.trips); sound('chip');
    }
    else if (action === 'refill') {
      if (locked()) return;
      state.balance = cents(state.balance + 10000);
      save(); render(); $('info-dialog').close(); sound('chip'); toast('$10,000 in free chips added. Enjoy your seat.');
    } else if (action) void act(action);
  });
  $('deal-btn').addEventListener('click',() => void deal());
  $('fullscreen-btn').addEventListener('click',() => void toggleFullscreen());
  document.addEventListener('fullscreenchange',syncFullscreen);
  $('bet-dialog-close').addEventListener('click',() => $('bet-dialog').close());
  $('bet-editor-done').addEventListener('click',() => $('bet-dialog').close());
  $('bankroll-btn').addEventListener('click',() => showDialog('bankroll'));
  $('dialog-close').addEventListener('click',() => $('info-dialog').close());
  $('info-dialog').addEventListener('click',event => { if (event.target === $('info-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
  $('sound-btn').addEventListener('click',() => { state.sound = !state.sound; save(); render(); sound('chip'); });
  for (const id of ['bet-input','trips-input']) {
    $(id).addEventListener('input',() => {
      if (locked()) return;
      if (!betError()) { undoBets.push({bet:state.bets[state.game],trips:state.bets.trips}); if (undoBets.length>30) undoBets.shift(); state.round = null; state.bets[state.game] = bet(); state.bets.trips = Number($('trips-input').value) || 0; save(); }
      updateBetting(); renderTable(); renderActions(); renderWagers();
    });
  }
  document.addEventListener('contextmenu',event => {
    const target = event.target.closest('[data-zone]');
    if (!target) return;
    event.preventDefault();
    if (!locked()) placeChip(target.dataset.zone,true);
  });
  document.addEventListener('dragstart',event => {
    const chip = event.target.closest('[data-chip]');
    if (!chip || locked()) { event.preventDefault(); return; }
    selectChip(Number(chip.dataset.chip));
    event.dataTransfer.setData('text/plain',chip.dataset.chip);
    event.dataTransfer.effectAllowed = 'copy';
  });
  document.addEventListener('dragover',event => {
    const target = event.target.closest('[data-zone]');
    if (!target || target.disabled || locked()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    target.classList.add('drag-over');
  });
  document.addEventListener('dragleave',event => event.target.closest('[data-zone]')?.classList.remove('drag-over'));
  document.addEventListener('drop',event => {
    const target = event.target.closest('[data-zone]');
    if (!target || target.disabled || locked()) return;
    event.preventDefault();
    target.classList.remove('drag-over');
    const value = Number(event.dataTransfer.getData('text/plain'));
    if (![5,25,50,100,500].includes(value)) return;
    selectedChip = value;
    placeChip(target.dataset.zone);
  });
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape' && document.fullscreenElement && !$('info-dialog').open && !$('bet-dialog').open) {
      void document.exitFullscreen().catch(()=>{});
      return;
    }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || busy || $('info-dialog').open || $('bet-dialog').open ||
        ['INPUT','TEXTAREA','SELECT','A'].includes(document.activeElement?.tagName)) return;
    if (event.key === 'Enter' && !active() && document.activeElement?.tagName !== 'BUTTON') { event.preventDefault(); void deal(); return; }
    if (ultimate()) return;
    const action = {h:'hit',s:'stand',d:'double',p:'split'}[event.key.toLowerCase()];
    if (action && E.blackjackActions(state.round,state.balance).includes(action)) { event.preventDefault(); void act(action); }
  });

  syncInputs();
  settleWallet();
  render();
  save();
})();
