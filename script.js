const suits = ['♠', '♥', '♦', '♣'];
const ranks =['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
let deck = [];
let players =[];
let dealer = { hand:[], isRevealed: false };

let currentExpectedTotal = 0;
let actionCallback = null;
let activePlayerIdx = -1;
let activeHandIdx = -1;
let roundActive = false; 

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function buildDeck() {
    deck =[];
    for(let d=0; d<6; d++) {
        for(let s of suits) {
            for(let r of ranks) deck.push({ rank: r, suit: s });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] =[deck[j], deck[i]];
    }
}

function getVal(rank) {
    if (['J','Q','K'].includes(rank)) return 10;
    if (rank === 'A') return 11;
    return parseInt(rank);
}

function getBestTotal(hand) {
    let total = 0, aces = 0;
    hand.forEach(c => { total += getVal(c.rank); if(c.rank === 'A') aces++; });
    while(total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}

function botAction(hand, dealerUpVal) {
    let total = getBestTotal(hand);
    let hasAce = hand.some(c => c.rank === 'A');
    let hardTotal = hand.reduce((sum, c) => sum + (c.rank === 'A' ? 1 : getVal(c.rank)), 0);
    let isSoft = hasAce && (hardTotal + 10 <= 21);

    if (hand.length === 2 && (total === 10 || total === 11) && dealerUpVal >= 2 && dealerUpVal <= 9) return 'DOUBLE';

    if (total <= 11) return 'HIT';
    if (total >= 17 && !isSoft) return 'STAND';
    if (isSoft) {
        if (total <= 17) return 'HIT';
        if (total === 18 &&[9, 10, 11].includes(dealerUpVal)) return 'HIT';
        return 'STAND';
    }
    if (total === 12 && dealerUpVal >= 4 && dealerUpVal <= 6) return 'STAND';
    if (total >= 13 && total <= 16 && dealerUpVal >= 2 && dealerUpVal <= 6) return 'STAND';
    
    return 'HIT';
}

function getChipColor(amt) {
    if(amt >= 100) return '#171717';
    if(amt >= 25) return '#22c55e';
    if(amt >= 5) return '#ef4444';
    return '#3b82f6';
}

function renderTable() {
    // Dealer
    const dHand = document.getElementById('dealer-hand');
    dHand.innerHTML = '';
    dealer.hand.forEach((c, i) => {
        let isNewest = (i === dealer.hand.length - 1 && dealer.hand.length > 2) ? 'animate-new' : '';
        if (i === 1 && !dealer.isRevealed) {
            dHand.innerHTML += `<div class="card hidden ${isNewest}"></div>`;
        } else {
            let color = ['♥','♦'].includes(c.suit) ? 'red' : '';
            dHand.innerHTML += `<div class="card ${color} ${isNewest}"><span class="card-mini">${c.rank}${c.suit}</span><span class="card-val">${c.rank}</span></div>`;
        }
    });

    // Players
    const pArc = document.getElementById('players-arc');
    pArc.innerHTML = '';
    players.forEach((p, pIdx) => {
        let spotHtml = `<div class="player-spot" id="spot-${pIdx}">`;
        p.hands.forEach((h, hIdx) => {
            let isFocus = (pIdx === activePlayerIdx && hIdx === activeHandIdx);
            let stateClass = isFocus ? 'spotlight' : (activePlayerIdx !== -1 && !isFocus ? 'dimmed' : '');
            
            let cardsHtml = h.cards.map((c, i) => {
                let color = ['♥','♦'].includes(c.suit) ? 'red' : '';
                let sideway = (h.isDouble && i === 2) ? 'sideways' : '';
                let isNewest = (i === h.cards.length - 1 && h.cards.length > 2) ? 'animate-new' : '';
                
                return `<div class="card ${color} ${sideway} ${isNewest}"><span class="card-mini">${c.rank}${c.suit}</span><span class="card-val">${c.rank}</span></div>`;
            }).join('');
            
            spotHtml += `<div class="hand ${stateClass}">${cardsHtml}</div>`;
        });
        
        let chipBg = getChipColor(p.bet);
        spotHtml += `<div class="bet-area"><div class="chip" style="background:${chipBg}">$${p.bet}</div></div></div>`;
        pArc.innerHTML += spotHtml;
    });

    // Dealer Focus
    const dSpot = document.getElementById('dealer-spot');
    if (activePlayerIdx === 'dealer') {
        dSpot.classList.remove('dimmed'); dSpot.classList.add('spotlight');
    } else if (activePlayerIdx >= 0) {
        dSpot.classList.remove('spotlight'); dSpot.classList.add('dimmed');
    } else {
        dSpot.classList.remove('spotlight', 'dimmed');
    }
}

const hud = document.getElementById('action-hud');
const hudTitle = document.getElementById('hud-title');
const hudInput = document.getElementById('hud-input');

function promptDealer(expected, title, callback) {
    if (!roundActive) return; 
    currentExpectedTotal = expected;
    actionCallback = callback;
    hudTitle.innerText = title;
    hud.classList.remove('hud-hidden');
    hudInput.value = '';
    hudInput.classList.remove('error-shake');
    setTimeout(() => { if (roundActive) hudInput.focus(); }, 50);
}

hudInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && roundActive) {
        let val = parseInt(hudInput.value);
        if (val === currentExpectedTotal) {
            hud.classList.add('hud-hidden');
            actionCallback();
        } else {
            hudInput.classList.remove('error-shake');
            void hudInput.offsetWidth; 
            hudInput.classList.add('error-shake');
            hudInput.value = '';
        }
    }
});

async function startRound() {
    roundActive = true;
    if(deck.length < 50) buildDeck();
    document.getElementById('deal-btn').style.display = 'none';
    document.getElementById('dealer-status').innerText = '';
    
    activePlayerIdx = -1; activeHandIdx = -1;
    let bets =[10, 15, 25, 50, 100];
    players = Array(3).fill(null).map(() => ({
        bet: bets[Math.floor(Math.random() * bets.length)],
        hands: [{ cards: [], isDouble: false }]
    }));
    dealer = { hand:[], isRevealed: false };

    renderTable();
    for(let i=0; i<2; i++) {
        for(let p of players) { 
            if(!roundActive) return;
            p.hands[0].cards.push(deck.pop()); await sleep(150); renderTable(); 
        }
        if(!roundActive) return;
        dealer.hand.push(deck.pop()); await sleep(150); renderTable();
    }
    
    if(roundActive) setTimeout(() => playHand(0, 0), 300);
}

async function playHand(pIdx, hIdx) {
    if (!roundActive) return;
    if (pIdx >= players.length) return playDealer();

    activePlayerIdx = pIdx; activeHandIdx = hIdx;
    renderTable();

    let handObj = players[pIdx].hands[hIdx];
    let cards = handObj.cards;
    let total = getBestTotal(cards);
    let upCardVal = getVal(dealer.hand[0].rank);

    if (cards.length === 2 && total === 21) {
        promptDealer(21, `SPOT ${pIdx+1} BLACKJACK`, () => nextHand(pIdx, hIdx));
        return;
    }

    promptDealer(total, `SPOT ${pIdx+1} TOTAL`, async () => {
        if (!roundActive) return;
        if (total >= 21 || handObj.isDouble) return nextHand(pIdx, hIdx);

        if (cards.length === 2 && cards[0].rank === cards[1].rank &&['8','A'].includes(cards[0].rank)) {
            let isAces = cards[0].rank === 'A';
            players[pIdx].hands = [{ cards: [cards[0]], isDouble: false }, { cards: [cards[1]], isDouble: false }];
            
            if(isAces) {
                players[pIdx].hands[0].cards.push(deck.pop());
                players[pIdx].hands[1].cards.push(deck.pop());
                renderTable();
                promptDealer(getBestTotal(players[pIdx].hands[0].cards), "SPLIT ACE 1", () => {
                    activeHandIdx = 1; renderTable();
                    promptDealer(getBestTotal(players[pIdx].hands[1].cards), "SPLIT ACE 2", () => nextHand(pIdx, 1));
                });
            } else {
                players[pIdx].hands[0].cards.push(deck.pop());
                await sleep(250); playHand(pIdx, 0);
            }
            return;
        }

        let action = botAction(cards, upCardVal);
        
        if (action === 'DOUBLE') {
            players[pIdx].bet *= 2;
            handObj.isDouble = true;
            handObj.cards.push(deck.pop());
            renderTable();
            await sleep(300);
            promptDealer(getBestTotal(handObj.cards), `SPOT ${pIdx+1} DOUBLE DOWN`, () => nextHand(pIdx, hIdx));
        } 
        else if (action === 'HIT') {
            handObj.cards.push(deck.pop());
            renderTable();
            await sleep(200);
            playHand(pIdx, hIdx); 
        } 
        else {
            nextHand(pIdx, hIdx);
        }
    });
}

function nextHand(pIdx, hIdx) {
    if (hIdx + 1 < players[pIdx].hands.length) playHand(pIdx, hIdx + 1);
    else playHand(pIdx + 1, 0);
}

function playDealer() {
    if (!roundActive) return;
    activePlayerIdx = 'dealer'; activeHandIdx = -1;
    dealer.isRevealed = true;
    renderTable();

    function dealerStep() {
        if (!roundActive) return;
        let total = getBestTotal(dealer.hand);
        promptDealer(total, "DEALER TOTAL", async () => {
            if (total < 17) {
                dealer.hand.push(deck.pop());
                renderTable();
                await sleep(300);
                dealerStep();
            } else {
                document.getElementById('dealer-status').innerText = total > 21 ? "Dealer Busts!" : `Stands on ${total}`;
                activePlayerIdx = -1; renderTable();
                setTimeout(() => { if (roundActive) document.getElementById('deal-btn').style.display = 'block'; }, 800);
            }
        });
    }
    setTimeout(dealerStep, 400);
}

let streak = 0;
const payoutBet = document.getElementById('payout-bet');
const payoutInput = document.getElementById('payout-input');
const payoutFeedback = document.getElementById('payout-feedback');

function nextPayout() {
    let bet = Math.floor(Math.random() * 50) + 1;
    payoutBet.innerText = bet;
    payoutInput.value = '';
    payoutInput.dataset.correct = (bet * 1.5).toFixed(2);
    payoutInput.focus();
}

payoutInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        let val = parseFloat(payoutInput.value);
        let correct = parseFloat(payoutInput.dataset.correct);
        if (Math.abs(val - correct) < 0.01) {
            payoutFeedback.innerText = "✅ CORRECT";
            payoutFeedback.style.color = "var(--success-green)";
            streak++; document.getElementById('payout-streak').innerText = streak;
            setTimeout(() => { payoutFeedback.innerText = ''; nextPayout(); }, 600);
        } else {
            payoutFeedback.innerText = `❌ WRONG. $${payoutBet.innerText} pays $${correct.toFixed(2)}`;
            payoutFeedback.style.color = "var(--alert-red)";
            streak = 0; document.getElementById('payout-streak').innerText = streak;
            setTimeout(() => { payoutFeedback.innerText = ''; nextPayout(); }, 2000);
        }
    }
});

function switchTab(mode) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${mode}`).classList.add('active');
    
    if(mode === 'game') {
        document.getElementById('payout-mode').style.display = 'none';
        document.getElementById('game-mode').style.display = 'flex';
        document.getElementById('deal-btn').style.display = 'block';
    } else {
        roundActive = false;
        hud.classList.add('hud-hidden');
        document.getElementById('game-mode').style.display = 'none';
        document.getElementById('payout-mode').style.display = 'flex';
        nextPayout();
    }
}

window.onload = buildDeck;
