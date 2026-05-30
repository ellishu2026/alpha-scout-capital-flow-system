# AlphaScout Capital Flow System V1.0 - Trading Logic Notes

## 1. System Role

This system is the stock selection layer, not the final trading execution layer.

It identifies potential short-term strong stock candidates based on:

1. Margin improvement
2. Free cash flow improvement
3. Capital inflow strength

## 2. Universe Logic

Pool A:
- US stocks with market capitalization between $50B and $300B

Pool B:
- US stocks with share price above $800

The two pools are independent and may overlap.

## 3. Scoring Formula

Composite Score = Margin Score × 30% + FCF Score × 40% + Capital Flow Score × 30%

## 4. Selection Output

The dashboard displays the Top 11 candidates sorted by Composite Score from high to low.

## 5. Future Trading Confirmation

Future versions should add:

- Trend confirmation
- Moving average structure
- Volume breakout confirmation
- Risk control
- Buy/sell signal rules
