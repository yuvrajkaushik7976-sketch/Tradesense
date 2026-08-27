# Tradesense — Phase 1: Charts & Price Dashboard

Personal Nifty 50 dashboard: live index + watchlist, top gainers/losers,
and candlestick charts. This is the first of four planned modules — trade
journal, news ticker, and periodic reports come next.

## What's inside

- `main.py` — FastAPI backend. Fetches Nifty 50 data via `yfinance` and
  serves it as JSON, plus hosts the frontend files.
- `static/` — the installable PWA (HTML/CSS/JS, no build step, no
  frameworks — easy to keep editing by hand as we add the next modules).
- `requirements.txt` — Python dependencies.

## 1. Run it locally first (only if you have a computer handy)

If you have access to a computer even briefly, testing there first makes errors easier to read:

```bash
cd tradesense
pip install -r requirements.txt
uvicorn main:app --reload
```

Open `http://localhost:8000`. If you're phone-only from the start, skip to step 2 — GitHub and Render will surface the same errors if something's wrong.

## 2. Get it online (GitHub + Render — both free, both doable from a phone browser)

This project is deliberately flat: just one `static` folder, nothing nested inside it. That means the whole upload fits in two batches from a phone's file picker.

**A. Create the GitHub repo**
1. github.com → sign up free if you don't have an account.
2. Tap **+** (top right) → **New repository**. Name it `tradesense`, keep it Public, create it.

**B. Upload the root files**
1. On the repo page: **Add file → Upload files**.
2. Select everything in the `tradesense` folder EXCEPT `static`: `main.py`, `requirements.txt`, `jsconfig.json`, `README.md`.
3. Commit changes.

**C. Upload the static folder**
1. **Add file → Create new file**. In the name box type `static/placeholder.txt` (typing the `static/` prefix makes GitHub create that folder). Any content. Commit.
2. Tap into the new `static` folder → **Add file → Upload files**.
3. Select all 7 files from your phone's `static` folder: `index.html`, `manifest.json`, `service-worker.js`, `app.js`, `styles.css`, `icon-192.png`, `icon-512.png`. Commit.
4. Open `placeholder.txt` → trash icon → commit, to delete it.

**D. Deploy on Render**
1. render.com → sign up with your GitHub account (one tap, no new password).
2. **New → Web Service** → pick your `tradesense` repo (yours may show as `TRADESENSE`, capitalization doesn't matter).
3. Build command: `pip install -r requirements.txt`
   Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   Instance type: **Free**.
4. **Create Web Service**, wait for it to say **Live** (a few minutes).
5. Tap the URL at the top (`https://tradesense.onrender.com`-style).

**E. Install it**
Open that URL in Chrome on your phone → **⋮** menu → **Add to Home Screen**.

**Free-tier caveat:** free Render services sleep after inactivity — first open after a while takes 20–30 seconds, then it's fast.

## Chart indicators

Every chart now shows SMA 20, SMA 50, and RSI 14 (Wilder's RSI, the same
definition most trading platforms use) alongside the candles. Tap **MA** or
**RSI** above the chart to hide either without refetching data. The RSI
panel has dashed lines at 70/30 (overbought/oversold) and scrolls in sync
with the price chart above it.

One honest limitation: on the **1Y** view (weekly candles, ~52 bars), SMA
50 only has room to show its last couple of points — 50 *weeks* of history
doesn't fully fit in a 1-year window. Everything else has enough bars to
display normally.

## Known things to keep an eye on

- **Wipro → BSE swap coming.** NSE announced on 11 Aug 2026 that BSE Ltd
  replaces Wipro in the Nifty 50 from **30 Sept 2026**. `main.py` has a
  comment at the ticker list — swap `WIPRO.NS` for `BSE.NS` after that
  date.
- **`TMPV.NS`** (Tata Motors Passenger Vehicles) reflects Tata Motors'
  demerger into separate listed entities. Worth a quick double-check
  against your broker before relying on it — it's the one ticker in the
  list I'd verify first if a chart looks wrong.
- Data updates roughly every 30–60 seconds (cached server-side) rather
  than tick-by-tick, to stay well within Yahoo Finance's rate limits.

## What's next

You ranked the build order as: **charts (done) → trade journal → news
ticker → reports.** The ticker strip at the top of the screen already
shows live index + movers — when we build the news module, it'll plug
into that same strip instead of price data.
