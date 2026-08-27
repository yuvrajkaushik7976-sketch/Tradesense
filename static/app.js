// @ts-nocheck
// ---------------------------------------------------------------------------
// Tradesense — frontend
// ---------------------------------------------------------------------------

const state = {
  symbol: null,
  range: "1D",
  watchlist: [],
  chart: null,
  series: null,
  maFastSeries: null,
  maSlowSeries: null,
  rsiChart: null,
  rsiSeries: null,
  lastIndicators: null,
  showMA: true,
  showRSI: true,
  _syncingRange: false,
};

const $ = (id) => document.getElementById(id);

function fmtNum(n, decimals = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "\u2014";
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtVolume(n) {
  if (n === null || n === undefined) return "\u2014";
  return n.toLocaleString("en-IN");
}

function shortSym(symbol) {
  return symbol.replace(".NS", "").replace("^NSEI", "NIFTY");
}

function pctBadge(pct) {
  const up = pct >= 0;
  return `<span class="${up ? "up" : "down"}">${up ? "\u25B2" : "\u25BC"} ${Math.abs(pct).toFixed(2)}%</span>`;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function getJSON(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadIndex() {
  try {
    const data = await getJSON("/api/index");
    renderHero(data);
    return data;
  } catch (e) {
    $("heroChange").textContent = "Couldn't load \u2014 pull to refresh";
    return null;
  }
}

async function loadMovers() {
  try {
    const data = await getJSON("/api/movers");
    renderMovers(data);
    return data;
  } catch (e) {
    $("gainersList").innerHTML = `<div class="empty-state">Couldn't load</div>`;
    $("losersList").innerHTML = `<div class="empty-state">Couldn't load</div>`;
    $("ticker").classList.remove("is-loading");
    $("tickerTrack").innerHTML = `<span class="ticker-item">Market data unavailable \u2014 tap refresh</span>`;
    return null;
  }
}

async function loadWatchlist() {
  try {
    const data = await getJSON("/api/watchlist");
    state.watchlist = data.items || [];
    renderChips(state.watchlist);
    if (!state.symbol && state.watchlist.length) {
      selectSymbol(state.watchlist[0].symbol, state.watchlist[0].name);
    }
    return data;
  } catch (e) {
    $("chipRow").innerHTML = `<div class="empty-state">Couldn't load watchlist</div>`;
    return null;
  }
}

async function loadHistory(symbol, range) {
  $("chart").style.opacity = "0.4";
  try {
    const data = await getJSON(`/api/history/${encodeURIComponent(symbol)}?range=${range}`);
    renderChart(data.candles);
    state.lastIndicators = data.indicators;
    renderIndicators(data.indicators);
    if (data.candles.length) renderStats(data.candles[data.candles.length - 1]);
  } catch (e) {
    $("chartTitle").textContent = "Couldn't load chart (" + (e.message || e) + ")";
  } finally {
    $("chart").style.opacity = "1";
  }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderHero(data) {
  const up = data.change_pct >= 0;
  $("heroPrice").textContent = fmtNum(data.price);
  $("heroPrice").className = `hero-price ${up ? "up" : "down"}`;
  $("heroChange").innerHTML = `${up ? "+" : ""}${fmtNum(data.change)} ${pctBadge(data.change_pct)}`;
  drawSparkline($("heroSpark"), data.sparkline, up);
}

function drawSparkline(canvas, values, isUp) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!values || values.length < 2) return;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = isUp ? "#3ECF8E" : "#E8604C";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function renderChips(items) {
  const row = $("chipRow");
  if (!items.length) {
    row.innerHTML = `<div class="empty-state">No watchlist data</div>`;
    return;
  }
  row.innerHTML = items
    .map((item) => {
      const up = item.change_pct >= 0;
      const active = item.symbol === state.symbol ? "is-active" : "";
      return `
        <button class="chip ${active}" data-symbol="${item.symbol}" data-name="${item.name}">
          <div class="chip-symbol">${shortSym(item.symbol)}</div>
          <div class="chip-price">${fmtNum(item.price)}</div>
          <div class="chip-pct ${up ? "up" : "down"}">${up ? "\u25B2" : "\u25BC"} ${Math.abs(item.change_pct).toFixed(2)}%</div>
        </button>`;
    })
    .join("");

  row.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => selectSymbol(chip.dataset.symbol, chip.dataset.name));
  });
}

function renderMovers(data) {
  const rowHtml = (items) =>
    items
      .map(
        (i) => `
      <div class="movers-row">
        <span class="sym">${shortSym(i.symbol)}</span>
        <span class="val ${i.change_pct >= 0 ? "up" : "down"}">${i.change_pct >= 0 ? "+" : ""}${i.change_pct.toFixed(2)}%</span>
      </div>`
      )
      .join("");
  $("gainersList").innerHTML = rowHtml(data.gainers);
  $("losersList").innerHTML = rowHtml(data.losers);

  renderTicker(data);
}

function renderTicker(moversData) {
  const track = $("tickerTrack");
  const items = [];

  if (window.__lastIndex) {
    const d = window.__lastIndex;
    items.push(`NIFTY 50 ${fmtNum(d.price)} ${pctBadge(d.change_pct)}`);
  }
  moversData.gainers.forEach((g) => items.push(`${shortSym(g.symbol)} <span class="tk-up">\u25B2 ${g.change_pct.toFixed(2)}%</span>`));
  moversData.losers.forEach((l) => items.push(`${shortSym(l.symbol)} <span class="tk-down">\u25BC ${Math.abs(l.change_pct).toFixed(2)}%</span>`));

  if (!items.length) return;
  const html = items.map((i) => `<span class="ticker-item">${i}</span>`).join("");
  track.innerHTML = html + html; // duplicated for a seamless scroll loop
  $("ticker").classList.remove("is-loading");
}

function ensureChart() {
  if (state.chart) return;

  state.chart = LightweightCharts.createChart($("chart"), {
    layout: {
      background: { color: "transparent" },
      textColor: "#7C8B84",
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "rgba(37,48,41,0.6)" },
      horzLines: { color: "rgba(37,48,41,0.6)" },
    },
    rightPriceScale: { borderColor: "#253029" },
    timeScale: { borderColor: "#253029", timeVisible: true, secondsVisible: false },
    autoSize: true,
  });
  state.series = state.chart.addCandlestickSeries({
    upColor: "#3ECF8E",
    downColor: "#E8604C",
    borderVisible: false,
    wickUpColor: "#3ECF8E",
    wickDownColor: "#E8604C",
  });
  state.maFastSeries = state.chart.addLineSeries({
    color: "#F0B429",
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  state.maSlowSeries = state.chart.addLineSeries({
    color: "#6C93C7",
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  state.rsiChart = LightweightCharts.createChart($("rsiChart"), {
    layout: {
      background: { color: "transparent" },
      textColor: "#7C8B84",
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 10,
    },
    grid: {
      vertLines: { color: "rgba(37,48,41,0.4)" },
      horzLines: { color: "rgba(37,48,41,0.4)" },
    },
    rightPriceScale: { borderColor: "#253029" },
    timeScale: { borderColor: "#253029", visible: false },
    autoSize: true,
  });
  state.rsiSeries = state.rsiChart.addLineSeries({
    color: "#9B8AC4",
    lineWidth: 1.5,
    priceLineVisible: false,
    lastValueVisible: true,
  });
  state.rsiSeries.createPriceLine({ price: 70, color: "#E8604C", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false });
  state.rsiSeries.createPriceLine({ price: 30, color: "#3ECF8E", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false });

  // Keep the price chart and the RSI panel scrolling/zooming together.
  state.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (state._syncingRange || !range) return;
    state._syncingRange = true;
    state.rsiChart.timeScale().setVisibleLogicalRange(range);
    state._syncingRange = false;
  });
  state.rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (state._syncingRange || !range) return;
    state._syncingRange = true;
    state.chart.timeScale().setVisibleLogicalRange(range);
    state._syncingRange = false;
  });
}

function renderChart(candles) {
  ensureChart();
  state.series.setData(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
  state.chart.timeScale().fitContent();
}

function renderIndicators(indicators) {
  if (!indicators || !state.chart) return;
  state.maFastSeries.setData(state.showMA ? indicators.sma20 : []);
  state.maSlowSeries.setData(state.showMA ? indicators.sma50 : []);
  state.rsiSeries.setData(state.showRSI ? indicators.rsi14 : []);
  $("rsiChart").style.display = state.showRSI ? "block" : "none";
}

function renderStats(lastCandle) {
  $("statOpen").textContent = fmtNum(lastCandle.open);
  $("statHigh").textContent = fmtNum(lastCandle.high);
  $("statLow").textContent = fmtNum(lastCandle.low);
  $("statVolume").textContent = fmtVolume(lastCandle.volume);
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

function selectSymbol(symbol, name) {
  state.symbol = symbol;
  $("chartTitle").textContent = `${name} \u00b7 ${shortSym(symbol)}`;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c.dataset.symbol === symbol));
  loadHistory(symbol, state.range);
}

$("rangePills").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn || !state.symbol) return;
  state.range = btn.dataset.range;
  document.querySelectorAll(".pill").forEach((p) => p.classList.toggle("is-active", p === btn));
  loadHistory(state.symbol, state.range);
});

$("toggleMA").addEventListener("click", () => {
  state.showMA = !state.showMA;
  $("toggleMA").classList.toggle("is-active", state.showMA);
  renderIndicators(state.lastIndicators);
});

$("toggleRSI").addEventListener("click", () => {
  state.showRSI = !state.showRSI;
  $("toggleRSI").classList.toggle("is-active", state.showRSI);
  renderIndicators(state.lastIndicators);
});

$("refreshBtn").addEventListener("click", async () => {
  $("refreshBtn").classList.add("spinning");
  await refreshAll();
  $("refreshBtn").classList.remove("spinning");
});

async function refreshAll() {
  // Run these at the same time — the index card shouldn't wait behind the
  // heavier 50-stock movers fetch, and vice versa.
  const [idx] = await Promise.all([
    loadIndex().then((d) => {
      if (d) window.__lastIndex = d;
      return d;
    }),
    loadMovers(),
    loadWatchlist(),
  ]);
  if (state.symbol) loadHistory(state.symbol, state.range);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}

refreshAll();
setInterval(() => {
  if (document.visibilityState === "visible") refreshAll();
}, 60000);
