const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const state = {
  round: null,
  payoutBet: null,
  rules: {
    dealerRule: "S17", // stand on soft/hard 17+
  },
};

const el = (id) => document.getElementById(id);

function createDeck(numDecks = 6) {
  const deck = [];
  for (let d = 0; d < numDecks; d++) {
    for (const s of suits) for (const r of ranks) deck.push({ rank: r, suit: s });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(rank) {
  if (["K", "Q", "J", "10"].includes(rank)) return 10;
  if (rank === "A") return 11;
  return Number(rank);
}

function handTotals(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  const soft = cards.some((c) => c.rank === "A") && total <= 21 && total + 10 <= 21 ? false : false;
  return { total, bust: total > 21, soft: isSoft(cards, total) };
}

function isSoft(cards, optimizedTotal) {
  let hard = cards.reduce((sum, c) => sum + (c.rank === "A" ? 1 : cardValue(c.rank)), 0);
  return cards.some((c) => c.rank === "A") && optimizedTotal !== hard;
}

function shouldSplit(hand, dealerUp) {
  if (hand.cards.length !== 2) return false;
  const [a, b] = hand.cards;
  if (cardValue(a.rank) !== cardValue(b.rank)) return false;
  const v = cardValue(a.rank);
  if (v === 8 || a.rank === "A") return true;
  if (v === 9 && ![7, 10, 11].includes(dealerUp)) return true;
  return false;
}

function playerShouldHit(cards, dealerUp) {
  const { total, soft } = handTotals(cards);
  if (total <= 11) return true;
  if (soft && total <= 17) return true;
  if (!soft && total <= 11) return true;
  if (!soft && total >= 17) return false;
  if (!soft && total >= 13 && total <= 16 && dealerUp <= 6) return false;
  if (total === 12 && dealerUp >= 4 && dealerUp <= 6) return false;
  return total < 17;
}

function dealRound() {
  const deck = createDeck();
  const players = [1, 2, 3].map((i) => ({ id: i, bet: Math.floor(Math.random() * 46) + 5, hands: [{ cards: [] }] }));
  const dealer = { cards: [] };

  for (let i = 0; i < 2; i++) {
    for (const p of players) p.hands[0].cards.push(deck.pop());
    dealer.cards.push(deck.pop());
  }

  const dealerUp = cardValue(dealer.cards[0].rank);

  for (const p of players) {
    const firstHand = p.hands[0];
    if (shouldSplit(firstHand, dealerUp)) {
      const c1 = firstHand.cards[0];
      const c2 = firstHand.cards[1];
      p.hands = [{ cards: [c1, deck.pop()] }, { cards: [c2, deck.pop()] }];
    }

    for (const hand of p.hands) {
      while (playerShouldHit(hand.cards, dealerUp)) {
        hand.cards.push(deck.pop());
        if (handTotals(hand.cards).bust) break;
      }
    }
  }

  while (true) {
    const { total, soft } = handTotals(dealer.cards);
    if (state.rules.dealerRule === "S17") {
      if (total < 17) dealer.cards.push(deck.pop()); else break;
    } else {
      if (total < 17 || (total === 17 && soft)) dealer.cards.push(deck.pop()); else break;
    }
    if (total > 21) break;
  }

  state.round = { players, dealer };
  renderRound();
  buildInputRows();
  el("feedback").textContent = "";
  el("dealerResult").textContent = "";
}

function cardHtml(c) {
  const red = c.suit === "♥" || c.suit === "♦";
  return `<div class="card ${red ? "red" : ""}">${c.rank}${c.suit}</div>`;
}

function renderRound() {
  if (!state.round) return;
  el("dealerCards").innerHTML = state.round.dealer.cards.map(cardHtml).join("");

  const playersMarkup = state.round.players.map((p) => {
    const hands = p.hands.map((h, idx) => {
      const t = handTotals(h.cards).total;
      return `<div><strong>Hand ${idx + 1}</strong> (bet $${p.bet})<div class="card-row">${h.cards.map(cardHtml).join("")}</div><div class="result">Actual: ${t}</div></div>`;
    }).join("<hr />");

    return `<div class="player-box"><h3>Player ${p.id}</h3>${hands}</div>`;
  }).join("");

  el("playersArea").innerHTML = playersMarkup;
}

function buildInputRows() {
  const rows = [];
  for (const p of state.round.players) {
    p.hands.forEach((_, idx) => {
      rows.push({ key: `p${p.id}h${idx + 1}`, label: `Player ${p.id} - Hand ${idx + 1}` });
    });
  }
  rows.push({ key: "dealer", label: "Dealer" });

  el("totalInputs").innerHTML = rows
    .map(
      (r) => `<div class="input-row"><label>${r.label}</label><input type="number" id="in_${r.key}" min="4" max="31" /></div>`
    )
    .join("");
}

function checkTotals() {
  if (!state.round) return;
  const feedback = [];

  for (const p of state.round.players) {
    p.hands.forEach((h, idx) => {
      const key = `in_p${p.id}h${idx + 1}`;
      const entered = Number(el(key).value);
      const actual = handTotals(h.cards).total;
      feedback.push(`${entered === actual ? "✅" : "❌"} Player ${p.id} Hand ${idx + 1}: ${entered || "(blank)"} / ${actual}`);
    });
  }

  const dEntered = Number(el("in_dealer").value);
  const dActual = handTotals(state.round.dealer.cards).total;
  feedback.push(`${dEntered === dActual ? "✅" : "❌"} Dealer: ${dEntered || "(blank)"} / ${dActual}`);

  const allGood = feedback.every((x) => x.startsWith("✅"));
  el("feedback").className = `feedback ${allGood ? "ok" : "bad"}`;
  el("feedback").innerHTML = feedback.join("<br />");

  const dealerTotal = handTotals(state.round.dealer.cards).total;
  el("dealerResult").textContent = `Dealer final total: ${dealerTotal}`;
}

function nextPayout() {
  state.payoutBet = Math.floor(Math.random() * 50) + 1;
  el("betPrompt").textContent = `Bet: ${state.payoutBet}`;
  el("payoutInput").value = "";
  el("payoutFeedback").textContent = "";
  el("payoutFeedback").className = "feedback";
}

function checkPayout() {
  const val = Number(el("payoutInput").value);
  const correct = Number((state.payoutBet * 1.5).toFixed(1));
  const ok = Math.abs(val - correct) < 0.001;
  el("payoutFeedback").className = `feedback ${ok ? "ok" : "bad"}`;
  el("payoutFeedback").textContent = ok
    ? `✅ Correct. ${state.payoutBet} pays ${correct}.`
    : `❌ Not quite. ${state.payoutBet} pays ${correct}.`;
}

function setupModes() {
  el("modeGame").onclick = () => {
    el("modeGame").classList.add("active");
    el("modePayout").classList.remove("active");
    el("gameMode").classList.remove("hidden");
    el("payoutMode").classList.add("hidden");
  };
  el("modePayout").onclick = () => {
    el("modePayout").classList.add("active");
    el("modeGame").classList.remove("active");
    el("payoutMode").classList.remove("hidden");
    el("gameMode").classList.add("hidden");
  };
}

function init() {
  el("ruleNotice").innerHTML = `
    <strong>Lac-Leamy / Casinos du Québec rule note:</strong>
    dealers can run either <em>H17</em> or <em>S17</em> depending on table signage.
    This trainer is set to <strong>S17</strong> by default (dealer hits 16 or less, stands on soft/hard 17+).
  `;

  setupModes();
  el("newRound").onclick = dealRound;
  el("checkTotals").onclick = checkTotals;
  el("nextPayout").onclick = nextPayout;
  el("checkPayout").onclick = checkPayout;

  dealRound();
  nextPayout();
}

init();
