"""
Tradesense backend.

Serves Nifty 50 market data (via yfinance) to the PWA frontend, and hosts
the frontend's static files so the whole app is one deployable unit.

Personal-use project — single user, no auth, no database yet (trade
journal / news modules come in later phases).
"""

import time
from typing import Optional

import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Tradesense API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Nifty 50 constituents, as of Aug 2026.
#
# NOTE: NSE announced on 11 Aug 2026 that BSE Ltd will replace Wipro in the
# Nifty 50, effective 30 Sept 2026. After that date, swap "WIPRO.NS" below
# for "BSE.NS".
#
# NOTE: "TMPV.NS" (Tata Motors Passenger Vehicles) reflects Tata Motors'
# 2024-25 demerger into separate commercial/passenger listed entities.
# Double-check this symbol against your broker/NSE before trusting it fully
# — demerger tickers are the one part of this list worth re-verifying.
# ---------------------------------------------------------------------------
NIFTY_INDEX = "^NSEI"

NIFTY50 = {
    "ADANIENT.NS": "Adani Enterprises",
    "ADANIPORTS.NS": "Adani Ports & SEZ",
    "APOLLOHOSP.NS": "Apollo Hospitals",
    "ASIANPAINT.NS": "Asian Paints",
    "AXISBANK.NS": "Axis Bank",
    "BAJAJ-AUTO.NS": "Bajaj Auto",
    "BAJFINANCE.NS": "Bajaj Finance",
    "BAJAJFINSV.NS": "Bajaj Finserv",
    "BEL.NS": "Bharat Electronics",
    "BHARTIARTL.NS": "Bharti Airtel",
    "CIPLA.NS": "Cipla",
    "COALINDIA.NS": "Coal India",
    "DRREDDY.NS": "Dr. Reddy's Labs",
    "EICHERMOT.NS": "Eicher Motors",
    "ETERNAL.NS": "Eternal",
    "GRASIM.NS": "Grasim Industries",
    "HCLTECH.NS": "HCLTech",
    "HDFCBANK.NS": "HDFC Bank",
    "HDFCLIFE.NS": "HDFC Life",
    "HINDALCO.NS": "Hindalco Industries",
    "HINDUNILVR.NS": "Hindustan Unilever",
    "ICICIBANK.NS": "ICICI Bank",
    "INDIGO.NS": "IndiGo",
    "INFY.NS": "Infosys",
    "ITC.NS": "ITC",
    "JIOFIN.NS": "Jio Financial Services",
    "JSWSTEEL.NS": "JSW Steel",
    "KOTAKBANK.NS": "Kotak Mahindra Bank",
    "LT.NS": "Larsen & Toubro",
    "M&M.NS": "Mahindra & Mahindra",
    "MARUTI.NS": "Maruti Suzuki",
    "MAXHEALTH.NS": "Max Healthcare",
    "NESTLEIND.NS": "Nestle India",
    "NTPC.NS": "NTPC",
    "ONGC.NS": "Oil & Natural Gas Corp",
    "POWERGRID.NS": "Power Grid Corp",
    "RELIANCE.NS": "Reliance Industries",
    "SBILIFE.NS": "SBI Life Insurance",
    "SHRIRAMFIN.NS": "Shriram Finance",
    "SBIN.NS": "State Bank of India",
    "SUNPHARMA.NS": "Sun Pharma",
    "TCS.NS": "Tata Consultancy Services",
    "TATACONSUM.NS": "Tata Consumer Products",
    "TMPV.NS": "Tata Motors Passenger Vehicles",
    "TATASTEEL.NS": "Tata Steel",
    "TECHM.NS": "Tech Mahindra",
    "TITAN.NS": "Titan Company",
    "TRENT.NS": "Trent",
    "ULTRACEMCO.NS": "UltraTech Cement",
    "WIPRO.NS": "Wipro",
}

WATCHLIST_DEFAULT = [
    "RELIANCE.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS", "TCS.NS",
    "BHARTIARTL.NS", "SBIN.NS", "BAJFINANCE.NS", "LT.NS", "ITC.NS",
]

RANGE_MAP = {
    "1D": ("1d", "5m"),
    "1W": ("5d", "15m"),
    "1M": ("1mo", "1d"),
    "3M": ("3mo", "1d"),
    "1Y": ("1y", "1wk"),
}

# ---------------------------------------------------------------------------
# Tiny in-memory cache. Personal single-user app — no need for Redis.
# Keeps a burst of phone refreshes from hammering Yahoo Finance.
# ---------------------------------------------------------------------------
_cache: dict[str, tuple[float, object]] = {}


def cached(key: str, ttl: float, fn):
    now = time.time()
    if key in _cache:
        ts, value = _cache[key]
        if now - ts < ttl:
            return value
    value = fn()
    _cache[key] = (now, value)
    return value


def _pct(cur: float, prev: float) -> float:
    return ((cur - prev) / prev) * 100 if prev else 0.0


# ---------------------------------------------------------------------------
# Technical indicators. Both take/return a plain pandas Series indexed the
# same as the source history, so callers can zip index + result together.
# ---------------------------------------------------------------------------

def calculate_sma(closes: pd.Series, period: int) -> pd.Series:
    return closes.rolling(window=period, min_periods=period).mean()


def calculate_rsi(closes: pd.Series, period: int = 14) -> pd.Series:
    """Wilder's RSI - the standard definition used by most trading platforms."""
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def series_to_points(index, series: pd.Series) -> list:
    """Zip a DatetimeIndex + indicator Series into chart points, dropping the
    NaN warm-up rows every rolling/ewm indicator starts with."""
    points = []
    for ts, value in zip(index, series):
        if pd.notna(value):
            points.append({"time": int(ts.timestamp()), "value": round(float(value), 2)})
    return points


def fetch_quote(ticker: str, name: Optional[str] = None) -> dict:
    hist = yf.Ticker(ticker).history(period="1mo")
    if hist.empty or len(hist) < 2:
        raise ValueError(f"not enough data for {ticker}")

    current = float(hist["Close"].iloc[-1])
    prev = float(hist["Close"].iloc[-2])
    week_ago = float(hist["Close"].iloc[-5]) if len(hist) >= 5 else float(hist["Close"].iloc[0])
    month_ago = float(hist["Close"].iloc[0])

    return {
        "symbol": ticker,
        "name": name or NIFTY50.get(ticker, ticker),
        "price": round(current, 2),
        "change": round(current - prev, 2),
        "change_pct": round(_pct(current, prev), 2),
        "week_change_pct": round(_pct(current, week_ago), 2),
        "month_change_pct": round(_pct(current, month_ago), 2),
        "volume": int(hist["Volume"].iloc[-1]),
        "day_high": round(float(hist["High"].iloc[-1]), 2),
        "day_low": round(float(hist["Low"].iloc[-1]), 2),
        "sparkline": [round(float(v), 2) for v in hist["Close"].tail(20)],
    }


# ---------------------------------------------------------------------------
# API routes (must be registered before the static-file mount below)
# ---------------------------------------------------------------------------

@app.get("/api/index")
def get_index():
    try:
        return cached("index", 30, lambda: fetch_quote(NIFTY_INDEX, name="NIFTY 50"))
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch Nifty index: {e}")


@app.get("/api/quote/{symbol}")
def get_quote(symbol: str):
    symbol = symbol.upper()
    try:
        return cached(f"quote:{symbol}", 30, lambda: fetch_quote(symbol))
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch {symbol}: {e}")


@app.get("/api/watchlist")
def get_watchlist():
    def fetch():
        items = []
        for t in WATCHLIST_DEFAULT:
            try:
                items.append(fetch_quote(t))
            except Exception:
                continue
        return {"items": items, "updated": int(time.time())}

    try:
        return cached("watchlist", 45, fetch)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch watchlist: {e}")


@app.get("/api/movers")
def get_movers():
    def fetch():
        tickers = list(NIFTY50.keys())
        data = yf.download(tickers, period="5d", group_by="ticker", progress=False, threads=True)
        results = []
        for t in tickers:
            try:
                closes = data[t]["Close"].dropna()
                if len(closes) < 2:
                    continue
                cur, prev = float(closes.iloc[-1]), float(closes.iloc[-2])
                results.append({
                    "symbol": t,
                    "name": NIFTY50[t],
                    "price": round(cur, 2),
                    "change_pct": round(_pct(cur, prev), 2),
                })
            except Exception:
                continue
        results.sort(key=lambda r: r["change_pct"], reverse=True)
        return {
            "gainers": results[:5],
            "losers": list(reversed(results[-5:])),
            "updated": int(time.time()),
        }

    try:
        return cached("movers", 60, fetch)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch movers: {e}")


@app.get("/api/history/{symbol}")
def get_history(symbol: str, range: str = "1M"):
    symbol = symbol.upper()
    range = range.upper()
    period, interval = RANGE_MAP.get(range, ("1mo", "1d"))

    def fetch():
        hist = yf.Ticker(symbol).history(period=period, interval=interval)
        if hist.empty:
            raise ValueError(f"no data for {symbol}")
        candles = [
            {
                "time": int(idx.timestamp()),
                "open": round(float(row.Open), 2),
                "high": round(float(row.High), 2),
                "low": round(float(row.Low), 2),
                "close": round(float(row.Close), 2),
                "volume": int(row.Volume) if row.Volume == row.Volume else 0,  # NaN guard
            }
            for idx, row in hist.iterrows()
        ]

        closes = hist["Close"]
        indicators = {
            "sma20": series_to_points(hist.index, calculate_sma(closes, 20)),
            "sma50": series_to_points(hist.index, calculate_sma(closes, 50)),
            "rsi14": series_to_points(hist.index, calculate_rsi(closes, 14)),
        }

        return {"symbol": symbol, "range": range, "candles": candles, "indicators": indicators}

    try:
        return cached(f"hist:{symbol}:{range}", 60, fetch)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch history for {symbol}: {e}")


@app.get("/api/symbols")
def get_symbols():
    return {"symbols": [{"symbol": k, "name": v} for k, v in NIFTY50.items()]}


# ---------------------------------------------------------------------------
# Static frontend (must be mounted last so it doesn't swallow /api/* routes)
# ---------------------------------------------------------------------------
app.mount("/", StaticFiles(directory="static", html=True), name="static")
