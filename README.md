# Club Royale

A full-window JavaScript casino with blackjack and Ultimate Texas Hold’em, played with free virtual chips.

Open **index.html** in a modern browser, or **embed.html** to try the game embedded in a page. There is no install or build step and no JavaScript framework dependency. Keep `index.html`, `styles.css`, `table-layout.css`, `script.js`, and `game-engine.js` together. Cards and table artwork are drawn locally with CSS and SVG; the older lounge assets are no longer required.

- Start with $10,000 in virtual chips. The wallet settings button can reset your bankroll to $1,000, $5,000, $10,000, $25,000, or a custom amount from $100 to $1,000,000. Reset clears the session; adding $10,000 is also available between hands.
- Both games share a bankroll. Bets, unfinished rounds, recent results, and balances survive refreshes for 30 minutes after the last saved activity. Refresh after that starts a fresh blackjack session at your chosen starting bankroll. Older saves without a timestamp also start fresh.
- A spacious green felt table uses conventional playing cards with suit pips and illustrated court faces. Blackjack hands use familiar, upright overlapping cards; split hands have their own clearly marked positions. Ultimate Hold’em keeps the dealer and community cards straight, with a slight fan only on the player’s two hole cards.
- The felt is taller and capped in width, with visible table limits and payout ratios. Short screens scroll vertically to keep cards, chips, and payouts readable. Use **Fullscreen** to fill the display and **Escape** to exit; your hand stays in progress.
- Select a chip, then click or drag it onto a betting circle. Ultimate Hold’em automatically matches Ante and Blind; Trips is separate. Right-click a circle to remove the selected chip amount.
- **Undo**, **Clear**, **Rebet**, and **Remove** are on the bottom control rail. Remove toggles subtraction for touch screens; right-click also removes the selected denomination. **Edit amount** opens the exact-bet editor. Opening chips are deducted when you deal. Chips retain their denominations and build physical stacks; payouts land on the wager before the enlarged stack returns to your wallet.
- Build a Play bet by clicking or dragging chips onto **Play**, then **Confirm Play**: 3× or 4× Ante before the flop, 2× on the flop, or 1× at the river. A partial stack stays editable and is saved without charging your wallet. Preset buttons remain for 4×, 2×, and 1×; 3× is placed manually.
- House qualification updates using only exposed cards, starting with pairs on the board. Qualifying cards rise 22px and glow blue. As dealer cards reveal individually, stronger combinations replace earlier highlights. Blackjack deals alternately to player/dealer, keeps the dealer hole card hidden, and finishes each split hand before dealing to the next.
- Change tables between rounds. **How to play** opens a short guide, **Rules & payouts** shows the full rules, **History** shows your session, and **Details** after a hand explains each wager’s settlement. A progress indicator tracks each hand, with the final result shown after the dealer reveal.
- Optional sound is controlled by the speaker button. Reduced-motion preferences are respected.
- Keyboard shortcuts: **Enter** deals between hands; blackjack uses **H** to hit, **S** to stand, **D** to double, and **P** to split. Ultimate Hold’em uses **C** to check, **F** to fold, and **1**, **2**, or **4** for an available Play multiplier. Shortcuts are inactive while a dialog or form control has focus or a manual Play stack awaits confirmation.

## Embed the game

`embed.html` is a working iframe example with a compact host-page toolbar. The game itself runs from `index.html`, so it can also be embedded in an existing site:

```html
<iframe
  src="https://your-site.example/club-royale/index.html"
  title="Club Royale — Blackjack and Ultimate Texas Hold’em"
  style="display:block;width:100%;height:100dvh;border:0"
  allow="fullscreen"
  allowfullscreen>
</iframe>
```

Replace the example URL with the address where you host the game files. Set the frame’s height to suit your page; the game adapts to the available space. Keep `allow="fullscreen"` and `allowfullscreen` so its Fullscreen button can expand the game. Browser storage settings determine whether embedded sessions can be saved.

## Table rules

Blackjack uses six decks, dealer hits soft 17, American hole-card peek, 3:2 natural blackjack, 1:1 ordinary wins, doubling after splitting, up to four hands, and half-bet insurance at 2:1. Split aces receive one card, cannot be resplit, and do not qualify for natural blackjack payouts. No surrender. Opening bets: $25–$2,000 in $5 increments.

Ultimate Texas Hold’em uses a fresh 52-card deck, matching Ante and Blind, one Play bet of 3×/4× before the flop, 2× after the flop, or 1× at the river. The dealer qualifies with a pair. An unqualified dealer pushes Ante on played hands, even if the player loses. Trips pays independently, including on folds. Ante: $25–$2,000; Trips: $0–$100, in $5 increments. At least 1× Ante must remain available for Play; Max reserves 4×.

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
node tests/browser-table-updates.cjs
```

The browser tests create an isolated temporary profile and save screenshots under `tests/artifacts/`.
