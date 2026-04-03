# Dealer Drill (Blackjack Trainer)

Simple static website for blackjack dealer practice:

- **Table Mode**: visual blackjack table from dealer perspective with 3 players, automatic bets, auto player actions, split support, ace values, and dealer total checking.
- **3:2 Payout Mode**: quick drill to memorize blackjack payouts for bets from 1 to 50.

## Run locally

Open `index.html` directly in a browser, or run a static server:

```bash
python3 -m http.server 8000
```

Then browse `http://localhost:8000`.

## Rules note

For Casinos du Québec blackjack rules, the official game rules indicate the house strategy is table-dependent:

- Either hit soft 17 or less, stand hard 17+
- Or hit 16 or less, stand on soft/hard 17+

This app defaults to **S17** behavior.
