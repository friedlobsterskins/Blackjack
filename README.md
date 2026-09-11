# Club Royale

A free, player-controlled casino with blackjack and Ultimate Texas Hold’em.

Open **index.html** in a modern browser. There is no install or build step. Keep `index.html`, `styles.css`, `script.js`, and `game-engine.js` together.

- Start with $10,000 in virtual chips. The + button adds another $10,000 between hands.
- Both games share a bankroll. Bets, unfinished rounds, recent results, and balances are saved in this browser when browser storage is available.
- Choose chips or type a bet, then deal. Change tables between rounds. Click **Table rules** for the exact rules and payout tables, or **Details** after a hand for every wager’s settlement.
- Optional sound is controlled by the speaker button. Reduced-motion preferences are respected.
- Blackjack keyboard controls: H hit, S stand, D double, P split. Enter deals between hands when a form control is not focused.

## Table rules

Blackjack uses six decks, dealer hits soft 17, American hole-card peek, 3:2 natural blackjack, 1:1 ordinary wins, doubling after splitting, up to four hands, and half-bet insurance at 2:1. Split aces receive one card, cannot be resplit, and do not qualify for natural blackjack payouts. No surrender. Opening bets: $5–$500 in $5 increments.

Ultimate Texas Hold’em uses a fresh 52-card deck, matching Ante and Blind, one Play bet of 3×/4× before the flop, 2× after the flop, or 1× at the river. The dealer qualifies with a pair. An unqualified dealer pushes Ante on played hands, even if the player loses. Trips pays independently, including on folds. Ante: $5–$200; Trips: $0–$100, in $5 increments. At least 1× Ante must remain available for Play; Max reserves 4×.

Casino table rules vary; the site posts its chosen rules. References are linked in the in-game rules dialog. All chips are fictional and have no cash value.

## Verification

Run the rules and controller tests with Node:

```sh
node --test --test-isolation=none tests/game-engine.test.js tests/controller.test.js
```

Browser integration tests use installed Chrome and Node’s built-in WebSocket support (Node 22+), with no npm dependencies:

```sh
node tests/browser-smoke.cjs
node tests/browser-splits.cjs
```

The browser tests create an isolated temporary profile and save screenshots under `tests/artifacts/`.
