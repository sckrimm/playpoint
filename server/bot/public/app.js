const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const decimalPlaces = (step) => {
  const numeric = Number(step);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const value = numeric.toFixed(12).replace(/0+$/, "");
  return Math.max(0, Math.min(8, (value.split(".")[1] ?? "").length));
};
const formatPrice = (value, tickSize = null) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  const absoluteValue = Math.abs(numericValue);
  const tickPrecision = decimalPlaces(tickSize);
  const adaptivePrecision = absoluteValue >= 1_000 ? 2 : absoluteValue >= 1 ? 4 : 8;
  const minimumPrecision = tickPrecision ?? 2;
  const maximumPrecision = Math.max(minimumPrecision, adaptivePrecision);
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: minimumPrecision, maximumFractionDigits: maximumPrecision,
  }).format(numericValue);
};
const formatSignedPrice = (value, tickSize = null) => `${value >= 0 ? "+" : "-"}${formatPrice(Math.abs(value), tickSize)}`;
const formatSignedMoney = (value) => `${value >= 0 ? "+" : "-"}${money.format(Math.abs(value))}`;
const formatDrawdown = (value) => value == null ? "—" : `${value >= 0.005 ? "-" : ""}${value.toFixed(2)}%`;
const performanceClass = (value) => value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
const riskLabel = (risk) => ({ LOW: "დაბალი", MEDIUM: "საშუალო", HIGH: "მაღალი" })[risk] ?? risk;
const signalLabel = (signal) => ({ WATCH: "დასაკვირვებელი", NEUTRAL: "ნეიტრალური", HIGH_RISK: "მაღალი რისკი" })[signal] ?? signal;
const binanceTradeUrl = (symbol) => {
  const quote = symbol.endsWith("USDT") ? "USDT" : "";
  const base = quote ? symbol.slice(0, -quote.length) : symbol;
  return `https://www.binance.com/en/trade/${encodeURIComponent(base)}_${encodeURIComponent(quote || "USDT")}`;
};
const byId = (id) => document.getElementById(id);
let selectedStrategyId = null;
let selectedStrategyStatus = null;
let selectedStrategy = null;
let selectedStrategyData = null;
let previousMarketPrice = null;
let symbolsLoaded = false;
let showingArchived = false;
let editingStrategyId = null;
let strategyTemplates = [];
let applyingTemplate = false;
let availableSymbols = new Set();
let selectedSymbolMarketPrice = null;
let symbolPriceRequest = 0;
let priceChart = null;
let candleSeries = null;
let chartMarkers = null;
let chartRange = "7d";
let chartRequest = 0;
let chartLastCandle = null;
let chartIntervalSeconds = 3600;
let chartOrderCount = 0;
let activeStrategies = [];
let comparisonData = null;
let comparisonSelection = new Set();
let backtestDays = 30;
let sessionUser = null;
let newsItems = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function newsSentimentLabel(value) {
  return ({ POSITIVE: "პოზიტიური გავლენა", NEUTRAL: "ნეიტრალური გავლენა", NEGATIVE: "ნეგატიური გავლენა" })[value] ?? value;
}

function coinDisplayName(symbol) {
  return ({ BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", BNB: "BNB", XRP: "XRP", DOGE: "Dogecoin", ADA: "Cardano", AVAX: "Avalanche", LINK: "Chainlink", DOT: "Polkadot", TRX: "TRON", TON: "Toncoin", SUI: "Sui", LTC: "Litecoin", SHIB: "Shiba Inu", PEPE: "Pepe" })[symbol] ?? symbol;
}

function applyCandidateLayout(layout, persist = true) {
  const normalized = layout === "rows" ? "rows" : "columns";
  byId("opportunityList").dataset.layout = normalized;
  byId("candidateLayout").querySelectorAll("button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.layout === normalized);
  });
  if (persist) {
    try { localStorage.setItem("spot-candidate-layout", normalized); } catch {}
  }
}

function isDarkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

function chartTheme() {
  return isDarkTheme()
    ? { background: "#1e2329", text: "#a7b2ac", grid: "#2b3139", border: "#3a414b", crosshair: "#707a86" }
    : { background: "#ffffff", text: "#66736c", grid: "#eef1ef", border: "#dce2df", crosshair: "#aab5af" };
}

function applyTheme(theme, persist = true) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalized;
  byId("themeToggle").setAttribute("aria-checked", String(normalized === "dark"));
  byId("themeToggle").title = normalized === "dark" ? "ღია რეჟიმზე გადასვლა" : "მუქ რეჟიმზე გადასვლა";
  if (persist) {
    try { localStorage.setItem("spot-theme", normalized); } catch {}
  }
  if (priceChart) {
    const colors = chartTheme();
    priceChart.applyOptions({
      layout: { background: { color: colors.background }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
      crosshair: { vertLine: { color: colors.crosshair }, horzLine: { color: colors.crosshair } },
    });
  }
}

function showLevelView(side) {
  const showingBuy = side === "BUY";
  byId("buyLevelsView").hidden = !showingBuy;
  byId("sellLevelsView").hidden = showingBuy;
  byId("showBuyLevels").classList.toggle("selected", showingBuy);
  byId("showSellLevels").classList.toggle("selected", !showingBuy);
  byId("showBuyLevels").setAttribute("aria-selected", String(showingBuy));
  byId("showSellLevels").setAttribute("aria-selected", String(!showingBuy));
}

function resetPriceChart() {
  if (priceChart) priceChart.remove();
  priceChart = null;
  candleSeries = null;
  chartMarkers = null;
  chartLastCandle = null;
}

function updateLiveChart(market) {
  if (!candleSeries || !chartLastCandle || !market) return;
  const eventSeconds = Math.floor(new Date(market.updatedAt).getTime() / 1000);
  const candleTime = Math.floor(eventSeconds / chartIntervalSeconds) * chartIntervalSeconds;
  const price = Number(market.price);
  if (!Number.isFinite(price) || price <= 0 || candleTime < chartLastCandle.time) return;
  chartLastCandle = candleTime === chartLastCandle.time
    ? { ...chartLastCandle, high: Math.max(chartLastCandle.high, price), low: Math.min(chartLastCandle.low, price), close: price }
    : { time: candleTime, open: chartLastCandle.close, high: Math.max(chartLastCandle.close, price), low: Math.min(chartLastCandle.close, price), close: price };
  candleSeries.update(chartLastCandle);
}

function pricePrecision(tickSize) {
  const normalized = String(tickSize ?? "0.01").replace(/0+$/, "");
  const decimals = normalized.includes(".") ? normalized.split(".")[1].length : 0;
  return { precision: decimals, minMove: Number(tickSize) || 0.01 };
}

async function loadPriceChart(strategyId, range = chartRange) {
  const requestId = ++chartRequest;
  chartRange = range;
  byId("chartRange").querySelectorAll("button").forEach((button) => button.classList.toggle("selected", button.dataset.range === range));
  const container = byId("priceChart");
  resetPriceChart();
  container.innerHTML = '<p id="chartState">Binance-ის სანთლები იტვირთება...</p>';
  try {
    const result = await api(`/api/strategies/${strategyId}/chart?range=${encodeURIComponent(range)}`);
    if (requestId !== chartRequest || strategyId !== selectedStrategyId) return;
    if (!window.LightweightCharts) throw new Error("გრაფიკის ბიბლიოთეკა ვერ ჩაიტვირთა");
    container.replaceChildren();
    const colors = chartTheme();
    priceChart = window.LightweightCharts.createChart(container, {
      autoSize: true,
      height: container.clientHeight,
      layout: { background: { color: colors.background }, textColor: colors.text, fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: colors.crosshair }, horzLine: { color: colors.crosshair } },
      localization: { locale: "ka-GE" },
    });
    candleSeries = priceChart.addSeries(window.LightweightCharts.CandlestickSeries, {
      upColor: "#138a56", downColor: "#c53c3c", borderVisible: false,
      wickUpColor: "#138a56", wickDownColor: "#c53c3c",
      priceFormat: pricePrecision(selectedStrategyData?.symbolRules?.tickSize),
    });
    candleSeries.setData(result.candles);
    chartLastCandle = { ...result.candles[result.candles.length - 1] };
    chartIntervalSeconds = result.interval === "5m" ? 300 : 3600;
    chartOrderCount = selectedStrategyData?.orders?.length ?? 0;

    const firstTime = result.candles[0]?.time ?? 0;
    const markers = (selectedStrategyData?.orders ?? []).map((order) => ({
      time: Math.floor(new Date(order.createdAt).getTime() / 1000 / chartIntervalSeconds) * chartIntervalSeconds,
      position: order.side === "BUY" ? "belowBar" : "aboveBar",
      color: order.side === "BUY" ? "#c53c3c" : "#148653",
      shape: order.side === "BUY" ? "arrowUp" : "arrowDown",
      text: order.side === "BUY" && order.levelPercent === 0 ? "საწყისი BUY" : `${order.side} ${order.side === "BUY" ? "-" : "+"}${order.levelPercent}%`,
    })).filter((marker) => marker.time >= firstTime).sort((a, b) => a.time - b.time);
    chartMarkers = window.LightweightCharts.createSeriesMarkers(candleSeries, markers);

    const dashed = window.LightweightCharts.LineStyle?.Dashed ?? 2;
    const levels = selectedStrategyData?.levels ?? [];
    for (const level of levels) candleSeries.createPriceLine({
      price: level.triggerPrice,
      color: level.side === "BUY" ? "#d47777" : "#58a985",
      lineWidth: 1, lineStyle: dashed, axisLabelVisible: true,
      title: `${level.side} ${level.side === "BUY" ? "-" : "+"}${level.levelPercent}%`,
    });
    if (selectedStrategyData?.strategy.averageEntryPrice > 0) candleSeries.createPriceLine({
      price: selectedStrategyData.strategy.averageEntryPrice,
      color: "#2874a6", lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "საშუალო",
    });
    candleSeries.createPriceLine({
      price: selectedStrategyData.strategy.initialEntryPrice,
      color: "#a78208", lineWidth: 1, lineStyle: dashed, axisLabelVisible: true, title: "საწყისი",
    });
    priceChart.timeScale().fitContent();
    byId("chartSubtitle").textContent = `${result.symbol} · Binance Spot · ${range === "24h" ? "ბოლო 24 საათი" : range === "30d" ? "ბოლო 30 დღე" : "ბოლო 7 დღე"}`;
  } catch (error) {
    if (requestId !== chartRequest) return;
    resetPriceChart();
    container.innerHTML = `<p id="chartState">გრაფიკი ვერ ჩაიტვირთა: ${error.message}</p>`;
  }
}

function updateInitialPriceHint() {
  const hint = byId("initialPriceHint");
  const enteredPrice = Number(byId("initialEntryPrice").value);
  if (!selectedSymbolMarketPrice || !Number.isFinite(enteredPrice) || enteredPrice <= 0) {
    hint.hidden = true;
    return;
  }
  const deviation = Math.abs(enteredPrice / selectedSymbolMarketPrice - 1) * 100;
  hint.hidden = false;
  if (deviation > 10) {
    hint.className = "field-hint warning";
    hint.textContent = `გაფრთხილება: ეს ფასი Binance-ის მიმდინარე ფასს ${deviation.toFixed(1)}%-ით სცდება (${formatPrice(selectedSymbolMarketPrice)}).`;
    return;
  }
  hint.className = "field-hint current";
  hint.textContent = `Binance-ის მიმდინარე ფასი: ${formatPrice(selectedSymbolMarketPrice)}`;
}

function updateInitialPurchaseHint() {
  const hint = byId("initialPurchaseHint");
  const totalBudget = Number(byId("createForm").elements.totalBudget.value);
  const initialPurchase = Number(byId("initialPurchaseAmount").value || 0);
  if (initialPurchase > 0 && totalBudget > 0 && initialPurchase >= totalBudget) {
    hint.className = "field-hint warning";
    hint.textContent = "საწყისი შესყიდვა სრულ ბიუჯეტზე ნაკლები უნდა იყოს.";
    return;
  }
  const remaining = totalBudget > 0 ? totalBudget - initialPurchase : null;
  hint.className = "field-hint";
  hint.textContent = initialPurchase > 0 && remaining !== null
    ? `შექმნისთანავე დაიხარჯება ${money.format(initialPurchase)}; BUY დონეებისთვის დარჩება ${money.format(Math.max(0, remaining))}.`
    : "არასავალდებულოა. 0-ის შემთხვევაში ბოტი პირველ BUY დონეს დაელოდება.";
}

async function useCurrentSymbolPrice() {
  const symbol = byId("symbolSearch").value.trim().toUpperCase();
  if (!availableSymbols.has(symbol)) return;
  const requestId = ++symbolPriceRequest;
  const hint = byId("initialPriceHint");
  hint.hidden = false;
  hint.className = "field-hint";
  hint.textContent = "Binance-ის მიმდინარე ფასი იტვირთება...";
  try {
    const environment = byId("executionEnvironment").value;
    const result = await api(`/api/symbols/${encodeURIComponent(symbol)}/price?environment=${encodeURIComponent(environment)}`);
    if (requestId !== symbolPriceRequest || byId("symbolSearch").value.trim().toUpperCase() !== symbol) return;
    selectedSymbolMarketPrice = Number(result.price);
    byId("initialEntryPrice").value = String(result.price);
    updateInitialPriceHint();
  } catch (error) {
    if (requestId !== symbolPriceRequest) return;
    selectedSymbolMarketPrice = null;
    hint.className = "field-hint warning";
    hint.textContent = `მიმდინარე ფასი ვერ ჩაიტვირთა: ${error.message}`;
  }
}

const statusLabels = { ACTIVE: "აქტიური", PAUSED: "შეჩერებული", COMPLETED: "დასრულებული", WAITING: "მოლოდინში", EXECUTING: "სრულდება", EXECUTED: "შესრულებული", FAILED: "შეცდომა" };
const connectionLabels = { CONNECTED: "დაკავშირებულია", CONNECTING: "კავშირდება", NOT_CONFIGURED: "არ არის გამართული", INVALID_KEY: "API გასაღები არასწორია", INVALID_SIGNATURE: "ხელმოწერა არასწორია", TIMESTAMP_ERROR: "დროის სინქრონიზაციის შეცდომა", RATE_LIMITED: "მოთხოვნების ლიმიტი ამოიწურა", ERROR: "კავშირის შეცდომა" };
const labelStatus = (status) => statusLabels[status] ?? status;
const labelConnection = (status) => connectionLabels[status] ?? status;

const appBasePath = window.location.pathname === "/bot" || window.location.pathname.startsWith("/bot/") ? "/bot" : "";
const appViews = ["overviewView", "detailView", "comparisonView", "marketCandidatesView", "newsView", "readinessView"];

function setVisibleView(view) {
  appViews.forEach((id) => { byId(id).hidden = id !== view; });
}

function updateNavigationState(view, strategyId = null, mode = "push") {
  const state = { ...(window.history.state ?? {}), appView: view, strategyId };
  window.history[mode === "replace" ? "replaceState" : "pushState"](state, "", window.location.href);
}

function showOverview({ historyMode = "push" } = {}) {
  chartRequest += 1;
  resetPriceChart();
  selectedStrategyId = null;
  selectedStrategy = null;
  selectedStrategyData = null;
  setVisibleView("overviewView");
  if (historyMode !== "none") updateNavigationState("overviewView", null, historyMode);
  void loadOverview();
}

function backToPreviousView() {
  if (window.history.state?.appView && window.history.state.appView !== "overviewView") window.history.back();
  else showOverview({ historyMode: "replace" });
}

async function api(url, options) {
  const response = await fetch(`${appBasePath}${url}`, { cache: "no-store", ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "მოთხოვნა ვერ შესრულდა");
  return payload;
}

function renderOverview(strategies) {
  const list = byId("strategyList");
  if (!strategies.length) {
    list.innerHTML = showingArchived
      ? '<div class="empty-state"><strong>არქივი ცარიელია</strong><span>დასრულებული სტრატეგიები აქ გამოჩნდება.</span></div>'
      : '<div class="empty-state"><strong>სტრატეგიები ჯერ არ არის</strong><span>დასაწყებად შექმენი SIMULATION სტრატეგია.</span></div>';
    return;
  }
  list.innerHTML = strategies.map((strategy) => {
    const totalPnl = strategy.performance?.totalPnl;
    const hasPosition = strategy.totalInvested > 0;
    const botResultClass = !hasPosition || totalPnl == null ? "neutral" : performanceClass(totalPnl);
    const botResultText = !hasPosition
      ? "ბოტს პოზიცია ჯერ არ აქვს"
      : totalPnl >= 0 ? `ბოტი პლიუსშია ${formatSignedMoney(totalPnl)}` : `ბოტი მინუსშია ${formatSignedMoney(totalPnl)}`;
    const botResultPercent = hasPosition && strategy.performance?.totalPnlPercent != null
      ? ` (${strategy.performance.totalPnlPercent >= 0 ? "+" : ""}${strategy.performance.totalPnlPercent.toFixed(2)}%)`
      : "";
    return `
    <article class="strategy-card" data-id="${strategy.id}" tabindex="0">
      <div class="strategy-card-head">
        <div class="strategy-identity"><strong>${strategy.symbol}</strong><span>${strategy.baseAsset} / ${strategy.quoteAsset}</span><span class="strategy-profile">შესვლა -${strategy.profile?.firstBuyDropPercent ?? "—"}% · ${strategy.profile?.buyLevelCount ?? 0} BUY / ${strategy.profile?.sellLevelCount ?? 0} SELL</span><span class="bot-result ${botResultClass}">${botResultText}${botResultPercent}</span></div>
        <div class="card-performance">
          <span class="card-status ${strategy.status.toLowerCase()}" data-status="${strategy.status}">${labelStatus(strategy.status)}</span>
          <span class="performance-line ${strategy.performance?.hourlyPnl == null ? "neutral" : performanceClass(strategy.performance.hourlyPnl)}"><small>1 საათში</small><strong>${strategy.performance?.hourlyPnl == null ? "—" : formatSignedMoney(strategy.performance.hourlyPnl)}</strong>${strategy.performance?.hourlyPercent == null ? "" : `<em>${strategy.performance.hourlyPercent >= 0 ? "+" : ""}${strategy.performance.hourlyPercent.toFixed(2)}%</em>`}</span>
          <span class="performance-line ${strategy.performance?.dailyPnl == null ? "neutral" : performanceClass(strategy.performance.dailyPnl)}"><small>24 საათში</small><strong>${strategy.performance?.dailyPnl == null ? "—" : formatSignedMoney(strategy.performance.dailyPnl)}</strong>${strategy.performance?.dailyPercent == null ? "" : `<em>${strategy.performance.dailyPercent >= 0 ? "+" : ""}${strategy.performance.dailyPercent.toFixed(2)}%</em>`}</span>
        </div>
      </div>
      <div class="strategy-card-metrics">
        <div><span>მიმდინარე ფასი</span><strong>${strategy.market ? formatPrice(strategy.market.price) : "—"}</strong></div>
        <div><span>საწყისი შესვლა</span><strong>${formatPrice(strategy.initialEntryPrice)}</strong></div>
        <div><span>ბიუჯეტი</span><strong>${money.format(strategy.totalBudget)}</strong></div>
        <div><span>ინვესტირებული</span><strong>${money.format(strategy.totalInvested)}</strong></div>
      </div>
      <div class="strategy-card-foot"><span>${strategy.executionEnvironment}</span>${strategy.status === "COMPLETED" ? '<span class="archived-label">არქივშია</span>' : `<button class="card-action" data-action="toggle" type="button">${strategy.status === "ACTIVE" ? "შეჩერება" : "გააქტიურება"}</button>`}</div>
    </article>`;
  }).join("");

  list.querySelectorAll(".strategy-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(Number(card.dataset.id)));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter") openDetail(Number(card.dataset.id)); });
    card.querySelector("[data-action='toggle']")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      const current = card.querySelector(".card-status").dataset.status;
      await setStatus(Number(card.dataset.id), current === "ACTIVE" ? "PAUSED" : "ACTIVE");
      await loadOverview();
    });
  });
}

async function loadOverview() {
  try {
    const endpoint = showingArchived ? "/api/strategies/archived" : "/api/strategies";
    const strategies = (await api(endpoint)).strategies;
    if (!showingArchived) activeStrategies = strategies;
    renderOverview(strategies);
    byId("error").hidden = true;
  } catch (error) { showError(error); }
}

async function loadOpportunities() {
  const list = byId("opportunityList");
  list.innerHTML = '<p class="empty-state">Binance-ის მონაცემები იტვირთება...</p>';
  try {
    const data = await api("/api/market-opportunities");
    byId("opportunityMethod").textContent = `${data.methodology} · განახლდა ${new Date(data.generatedAt).toLocaleTimeString("ka-GE")}`;
    list.innerHTML = data.items.length ? data.items.map((item) => `<article class="opportunity">
      <div class="opportunity-head"><div><strong>${item.symbol}</strong><small class="signal-${item.signal.toLowerCase().replace("_", "-")}">${signalLabel(item.signal)}</small></div><span class="opportunity-score signal-${item.signal.toLowerCase().replace("_", "-")}">${item.score}/100</span></div>
      <div class="opportunity-metrics"><span>ფასი <strong>${formatPrice(item.price)}</strong></span><span>24ს <strong class="${performanceClass(item.change24hPercent)}">${item.change24hPercent >= 0 ? "+" : ""}${item.change24hPercent.toFixed(2)}%</strong></span><span>RSI <strong>${item.rsi14 == null ? "—" : item.rsi14.toFixed(1)}</strong></span><span>რისკი <strong>${riskLabel(item.risk)}</strong></span></div>
      <div class="opportunity-reasons">${item.reasons.join(" · ")}</div>
      <div class="opportunity-actions"><a class="card-action binance-link" href="${binanceTradeUrl(item.symbol)}" target="_blank" rel="noopener noreferrer" title="${item.symbol}-ის Binance Spot გრაფიკის გახსნა">Binance გრაფიკი ↗</a><button class="card-action opportunity-create" data-symbol="${item.symbol}" type="button">SIMULATION სტრატეგიის შექმნა</button></div>
    </article>`).join("") : '<p class="empty-state">შეფასებისთვის საკმარისი მონაცემი ვერ მოიძებნა.</p>';
    list.querySelectorAll(".opportunity-create").forEach((button) => button.addEventListener("click", async () => {
      byId("createDialog").showModal();
      try {
        await Promise.all([loadSymbols(), loadTemplates()]);
        prepareCreateForm();
        byId("symbolSearch").value = button.dataset.symbol;
        await useCurrentSymbolPrice();
      } catch (error) { byId("formError").textContent = error.message; byId("formError").hidden = false; }
    }));
  } catch (error) {
    list.innerHTML = `<p class="empty-state">შეფასება ვერ ჩაიტვირთა: ${error.message}</p>`;
  }
}

function renderNews() {
  const source = byId("newsSource").value;
  const sentiment = byId("newsSentiment").value;
  const filtered = newsItems.filter((item) => (source === "ALL" || item.source === source) && (sentiment === "ALL" || item.sentiment === sentiment));
  byId("newsList").innerHTML = filtered.length ? filtered.map((item) => {
    const newsIndex = newsItems.indexOf(item);
    const articleUrl = safeHttpUrl(item.url);
    const imageUrl = safeHttpUrl(item.imageUrl);
    const image = imageUrl ? `<img class="news-image" src="${escapeHtml(imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<div class="news-image news-image-placeholder" aria-hidden="true"></div>';
    const sentimentClass = item.sentiment.toLowerCase();
    return `<article class="news-card" data-news-index="${newsIndex}" tabindex="0" role="button" aria-label="სიახლის გახსნა: ${escapeHtml(item.title)}">
      ${image}
      <div class="news-card-body">
        <div class="news-card-meta"><strong>${escapeHtml(item.source)}</strong><time datetime="${escapeHtml(item.publishedAt)}">${new Date(item.publishedAt).toLocaleString("ka-GE", { dateStyle: "medium", timeStyle: "short" })}</time>${item.translated ? "" : '<span class="translation-warning">თარგმანი დროებით მიუწვდომელია</span>'}</div>
        <h2 title="${escapeHtml(item.originalTitle)}">${escapeHtml(item.title)}</h2>
        <p>${escapeHtml(item.summary)}</p>
        <div class="news-tags"><span class="news-chip news-sentiment ${sentimentClass}" title="ნიუსის სავარაუდო გავლენა კრიპტო ბაზარზე">${newsSentimentLabel(item.sentiment)}</span>${item.coins.map((coin) => `<span class="news-chip news-coin" title="ნიუსი ეხება ${escapeHtml(coinDisplayName(coin))}-ს"><strong>${escapeHtml(coin)}</strong> · ${escapeHtml(coinDisplayName(coin))}</span>`).join("")}</div>
        ${articleUrl ? `<a class="card-action news-original" href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer">ორიგინალის ნახვა ↗</a>` : ""}
      </div>
    </article>`;
  }).join("") : '<p class="empty-state">ამ ფილტრით სიახლეები ვერ მოიძებნა.</p>';
  byId("newsList").querySelectorAll("[data-news-index]").forEach((card) => {
    const open = () => openNewsDetail(Number(card.dataset.newsIndex));
    card.addEventListener("click", (event) => { if (!event.target.closest("a, button")) open(); });
    card.addEventListener("keydown", (event) => {
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); open(); }
    });
  });
}

function renderNewsDetail(item, content, status = "") {
  const articleUrl = safeHttpUrl(item.url);
  const imageUrl = safeHttpUrl(item.imageUrl);
  const sentimentClass = item.sentiment.toLowerCase();
  byId("newsDetail").innerHTML = `
    <div class="news-detail-hero">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" referrerpolicy="no-referrer" />` : '<div class="news-detail-placeholder" aria-hidden="true"></div>'}
      <div class="news-detail-overlay">
        <div class="news-card-meta"><strong>${escapeHtml(item.source)}</strong><time datetime="${escapeHtml(item.publishedAt)}">${new Date(item.publishedAt).toLocaleString("ka-GE", { dateStyle: "medium", timeStyle: "short" })}</time></div>
        <h2>${escapeHtml(item.title)}</h2>
      </div>
      <button id="closeNewsDetail" class="icon-button news-detail-close" type="button" aria-label="დახურვა">×</button>
    </div>
    <div class="news-detail-body">
      ${status ? `<p class="news-detail-status">${escapeHtml(status)}</p>` : ""}
      ${item.translated ? "" : '<p class="translation-warning">ქართული თარგმანი დროებით მიუწვდომელია.</p>'}
      <p class="news-detail-summary">${escapeHtml(content)}</p>
      <div class="news-tags"><span class="news-chip news-sentiment ${sentimentClass}">${newsSentimentLabel(item.sentiment)}</span>${item.coins.map((coin) => `<span class="news-chip news-coin"><strong>${escapeHtml(coin)}</strong> · ${escapeHtml(coinDisplayName(coin))}</span>`).join("")}</div>
      ${articleUrl ? `<a class="primary-button news-detail-original" href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer">ორიგინალის ნახვა ↗</a>` : ""}
    </div>`;
  byId("closeNewsDetail").addEventListener("click", () => byId("newsDialog").close());
}

async function openNewsDetail(index) {
  const item = newsItems[index];
  if (!item) return;
  renderNewsDetail(item, item.summary, "ვრცელი ქართული ვერსია იტვირთება...");
  byId("newsDialog").showModal();
  try {
    const detail = await api(`/api/news/${encodeURIComponent(item.id)}`);
    renderNewsDetail(item, detail.content || item.summary, detail.expanded ? "ვრცელი თარგმანი" : "წყაროს ხელმისაწვდომი ტექსტი");
  } catch {
    renderNewsDetail(item, item.summary, "ვრცელი ტექსტი ვერ ჩაიტვირთა; ნაჩვენებია მოკლე ვერსია");
  }
}

async function loadNews() {
  byId("newsList").innerHTML = '<p class="empty-state">სიახლეები და ქართული თარგმანი იტვირთება...</p>';
  try {
    const data = await api("/api/news");
    newsItems = data.items;
    const select = byId("newsSource");
    const selected = select.value;
    select.replaceChildren(new Option("ყველა წყარო", "ALL"), ...data.sources.map((source) => new Option(source, source)));
    select.value = data.sources.includes(selected) ? selected : "ALL";
    byId("newsMeta").textContent = `${data.sources.join(" · ")} · განახლდა ${new Date(data.generatedAt).toLocaleTimeString("ka-GE")}`;
    renderNews();
  } catch (error) {
    byId("newsList").innerHTML = `<p class="empty-state">სიახლეები ვერ ჩაიტვირთა: ${escapeHtml(error.message)}</p>`;
  }
}

function renderComparison(data, preserveSelection = false) {
  comparisonData = data;
  const grid = byId("comparisonGrid");
  const items = data.comparisons ?? [];
  if (!preserveSelection) comparisonSelection = new Set(items.map((item) => item.id));
  const historyHours = data.drawdownHistoryHours || 0;
  const historyLabel = historyHours >= 24 ? `ბოლო ${Math.ceil(historyHours / 24)} დღის ფასების ისტორიით` : `ბოლო ${historyHours} საათის ფასების ისტორიით`;
  byId("comparisonSummary").textContent = `${data.symbol} · მიმდინარე ფასი ${data.marketPrice == null ? "—" : formatPrice(data.marketPrice)} · მაქსიმალური ვარდნა დათვლილია ${historyLabel}`;
  const choices = byId("comparisonChoices");
  choices.innerHTML = items.map((item) => `<label class="comparison-choice"><input type="checkbox" value="${item.id}" ${comparisonSelection.has(item.id) ? "checked" : ""}/><span>${item.firstBuyDropPercent == null ? "Custom" : `-${item.firstBuyDropPercent}%`} · #${item.id}</span></label>`).join("");
  choices.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) comparisonSelection.add(Number(input.value));
    else comparisonSelection.delete(Number(input.value));
    renderComparison(comparisonData, true);
    byId("backtestResults").replaceChildren();
    byId("backtestState").textContent = "არჩევანი შეიცვალა — ისტორიული ტესტი თავიდან გაუშვი.";
  }));
  byId("comparisonCreate").textContent = items.length < 2 ? "+ მეორე სტრატეგიის შექმნა" : "+ სხვა სტრატეგიის შექმნა";
  const selectedItems = items.filter((item) => comparisonSelection.has(item.id));
  const comparableProfits = selectedItems.filter((item) => item.profit !== null);
  const bestProfit = comparableProfits.length ? Math.max(...comparableProfits.map((item) => item.profit)) : null;
  const notice = selectedItems.length < 2 ? '<p class="comparison-notice">შედარებისთვის მონიშნე მინიმუმ ორი სტრატეგია. თუ მეორე ჯერ არ გაქვს, დააჭირე „მეორე სტრატეგიის შექმნა“.</p>' : "";
  const lowestDrawdown = selectedItems.filter((item) => item.maximumDrawdownPercent !== null)
    .sort((a, b) => a.maximumDrawdownPercent - b.maximumDrawdownPercent)[0] ?? null;
  const bestItem = bestProfit === null ? null : selectedItems.find((item) => item.profit === bestProfit);
  const mostEfficient = [...selectedItems].filter((item) => item.totalBudget > 0 && item.profit !== null)
    .sort((a, b) => (b.profit / b.totalBudget) - (a.profit / a.totalBudget))[0] ?? null;
  const insights = byId("comparisonInsights");
  insights.hidden = selectedItems.length < 2;
  insights.innerHTML = selectedItems.length < 2 ? "" : `
    <div><span>მოგების ლიდერი</span><strong>${bestItem ? `#${bestItem.id} · ${formatSignedMoney(bestItem.profit)}` : "—"}</strong></div>
    <div><span>ყველაზე მცირე ვარდნა</span><strong>${lowestDrawdown ? `#${lowestDrawdown.id} · ${formatDrawdown(lowestDrawdown.maximumDrawdownPercent)}` : "—"}</strong></div>
    <div><span>ბიუჯეტის საუკეთესო შედეგი</span><strong>${mostEfficient ? `#${mostEfficient.id} · ${(mostEfficient.profit / mostEfficient.totalBudget * 100).toFixed(2)}%` : "—"}</strong></div>`;
  const rows = selectedItems.map((item) => {
    const isBest = bestProfit !== null && item.profit === bestProfit;
    const profitClass = item.profit == null ? "neutral" : performanceClass(item.profit);
    const leaderDifference = item.profit === null || bestProfit === null ? null : item.profit - bestProfit;
    return `<tr class="${isBest ? "comparison-winner" : ""}">
      <td><strong>${item.symbol}</strong><span>${item.firstBuyDropPercent == null ? "Custom" : `-${item.firstBuyDropPercent}% შესვლა`} · #${item.id}</span></td>
      <td><strong class="${profitClass}">${item.profit == null ? "—" : formatSignedMoney(item.profit)}</strong><span>${item.profitPercent == null ? "—" : `${item.profitPercent >= 0 ? "+" : ""}${item.profitPercent.toFixed(2)}%`}</span></td>
      <td class="${leaderDifference < 0 ? "negative" : "positive"}">${isBest ? "ლიდერი" : leaderDifference == null ? "—" : formatSignedMoney(leaderDifference)}</td>
      <td class="${item.maximumDrawdownPercent >= 0.005 ? "negative" : "neutral"}">${formatDrawdown(item.maximumDrawdownPercent)}</td>
      <td><strong>${money.format(item.totalInvested)}</strong><span>${item.budgetUsedPercent.toFixed(1)}% ბიუჯეტიდან</span></td>
      <td><strong>${item.executedOrderCount}</strong><span>${item.buyOrderCount} BUY · ${item.sellOrderCount} SELL</span></td>
      <td><button class="comparison-open" data-strategy-id="${item.id}" type="button">გახსნა</button></td>
    </tr>`;
  }).join("");
  grid.innerHTML = `${notice}<div class="comparison-table-wrap"><table class="comparison-table"><thead><tr><th>სტრატეგია</th><th>შედეგი</th><th>ლიდერთან სხვაობა</th><th>მაქს. ვარდნა</th><th>ბიუჯეტი</th><th>ორდერები</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  grid.querySelectorAll("[data-strategy-id]").forEach((button) => button.addEventListener("click", () => openDetail(Number(button.dataset.strategyId))));
}

async function loadComparison(symbol) {
  byId("comparisonGrid").innerHTML = '<p class="empty-state">შედარება იტვირთება...</p>';
  byId("backtestResults").replaceChildren();
  byId("backtestState").className = "backtest-state";
  byId("backtestState").textContent = "აირჩიე პერიოდი და გაუშვი ისტორიული ტესტი.";
  try {
    renderComparison(await api(`/api/strategies/comparison?symbol=${encodeURIComponent(symbol)}`));
    byId("error").hidden = true;
  } catch (error) { showError(error); }
}

function renderBacktest(data) {
  const selectedResults = data.results.filter((item) => comparisonSelection.has(item.id));
  const results = byId("backtestResults");
  if (!selectedResults.length) {
    results.innerHTML = '<p class="comparison-notice">Backtest-ისთვის მინიმუმ ერთი სტრატეგია მონიშნე.</p>';
    return;
  }
  const bestPercent = Math.max(...selectedResults.map((item) => item.profitPercent));
  const periodStart = new Date(data.from).toLocaleDateString("ka-GE");
  const periodEnd = new Date(data.to).toLocaleDateString("ka-GE");
  const rows = selectedResults.map((item) => {
    const winner = item.profitPercent === bestPercent;
    const profitClass = performanceClass(item.profit);
    return `<tr class="${winner ? "backtest-winner" : ""}">
      <td><strong>${item.symbol}</strong><span>${item.firstBuyDropPercent == null ? "Custom" : `-${item.firstBuyDropPercent}% შესვლა`} · #${item.id}${winner ? " · ლიდერი" : ""}</span></td>
      <td><strong class="${profitClass}">${formatSignedMoney(item.profit)}</strong><span class="${profitClass}">${item.profitPercent >= 0 ? "+" : ""}${item.profitPercent.toFixed(2)}%</span></td>
      <td>${formatDrawdown(item.maximumDrawdownPercent)}</td>
      <td><strong>${money.format(item.totalInvested)}</strong><span>${item.budgetUsedPercent.toFixed(1)}% ბიუჯეტიდან</span></td>
      <td><strong>${item.buyOrderCount + item.sellOrderCount}</strong><span>${item.buyOrderCount} BUY · ${item.sellOrderCount} SELL</span></td>
      <td><strong>${money.format(item.finalEquity)}</strong><span>საბოლოო ღირებულება</span></td>
    </tr>`;
  }).join("");
  results.innerHTML = `<div class="backtest-summary"><span>პერიოდი: <strong>${periodStart} – ${periodEnd}</strong></span><span>მონაცემები: <strong>${data.candleCount} საათი</strong></span><span>საწყისი ფასი: <strong>${formatPrice(selectedResults[0].initialPrice)}</strong></span><span>საბოლოო ფასი: <strong>${formatPrice(selectedResults[0].finalPrice)}</strong></span></div>
    <div class="backtest-table-wrap"><table class="backtest-table"><thead><tr><th>სტრატეგია</th><th>შედეგი</th><th>მაქს. ვარდნა</th><th>ათვისებული ბიუჯეტი</th><th>ორდერები</th><th>საბოლოო ღირებულება</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function runBacktest() {
  const symbol = byId("comparisonSymbol").value;
  const state = byId("backtestState");
  state.className = "backtest-state loading";
  state.textContent = `${backtestDays} დღის Binance მონაცემები იტვირთება და სტრატეგიები მოწმდება...`;
  byId("runBacktest").disabled = true;
  try {
    const data = await api(`/api/strategies/backtest?symbol=${encodeURIComponent(symbol)}&days=${backtestDays}`);
    renderBacktest(data);
    state.className = "backtest-state";
    state.textContent = "Backtest დასრულდა. შედეგები ეფუძნება საათობრივ OHLC ფასებს და არ ითვალისწინებს საკომისიოსა და slippage-ს.";
  } catch (error) {
    state.className = "backtest-state error";
    state.textContent = `Backtest ვერ შესრულდა: ${error.message}`;
  } finally {
    byId("runBacktest").disabled = false;
  }
}

async function openCreateForComparison() {
  const symbol = byId("comparisonSymbol").value;
  byId("createDialog").showModal();
  try {
    await Promise.all([loadSymbols(), loadTemplates()]);
    prepareCreateForm();
    byId("symbolSearch").value = symbol;
    await useCurrentSymbolPrice();
  } catch (error) {
    byId("formError").textContent = error.message;
    byId("formError").hidden = false;
  }
}

async function openComparison({ historyMode = "push" } = {}) {
  if (!activeStrategies.length) activeStrategies = (await api("/api/strategies")).strategies;
  const counts = activeStrategies.reduce((result, strategy) => result.set(strategy.symbol, (result.get(strategy.symbol) ?? 0) + 1), new Map());
  const symbols = [...counts.keys()].sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b));
  const select = byId("comparisonSymbol");
  select.replaceChildren(...symbols.map((symbol) => {
    const option = document.createElement("option");
    option.value = symbol;
    option.textContent = `${symbol} · ${counts.get(symbol)} სტრატეგია`;
    return option;
  }));
  setVisibleView("comparisonView");
  if (historyMode !== "none") updateNavigationState("comparisonView", null, historyMode);
  if (symbols[0]) await loadComparison(symbols[0]);
  else byId("comparisonGrid").innerHTML = '<div class="empty-state"><strong>აქტიური სტრატეგიები ჯერ არ არის</strong><span>ჯერ შექმენი ერთი coin-ის რამდენიმე სტრატეგია.</span></div>';
}

function openMarketCandidates({ historyMode = "push" } = {}) {
  setVisibleView("marketCandidatesView");
  if (historyMode !== "none") updateNavigationState("marketCandidatesView", null, historyMode);
  void loadOpportunities();
}

function openNews({ historyMode = "push" } = {}) {
  setVisibleView("newsView");
  if (historyMode !== "none") updateNavigationState("newsView", null, historyMode);
  void loadNews();
}

function readinessLabel(status) {
  return ({ OK: "OK", WAITING: "მოლოდინი", WARNING: "ყურადღება", ERROR: "შეცდომა" })[status] ?? status;
}

function renderReadiness(data) {
  const overall = ({
    READY: ["მზადაა", "ყველა აუცილებელი შემოწმება გავლილია"],
    OBSERVING: ["დაკვირვება გრძელდება", "სისტემა მუშაობს, მაგრამ მეტი Testnet მონაცემია საჭირო"],
    BLOCKED: ["გადასვლა დაბლოკილია", "ერთი ან მეტი აუცილებელი შემოწმება ვერ გაიარა"],
  })[data.overall];
  const okCount = data.checks.filter((check) => check.status === "OK").length;
  byId("readinessSummary").innerHTML = `<section class="readiness-overall ${data.overall.toLowerCase()}"><div><span>საერთო სტატუსი</span><strong>${overall[0]}</strong><p>${overall[1]}</p></div><b>${okCount} / ${data.checks.length} OK</b></section>`;
  byId("readinessChecks").innerHTML = data.checks.map((check) => `<article class="readiness-check ${check.status.toLowerCase()}"><span class="readiness-icon">${check.status === "OK" ? "✓" : check.status === "ERROR" ? "!" : "…"}</span><div><strong>${escapeHtml(check.label)}</strong><p>${escapeHtml(check.detail)}</p></div><em>${readinessLabel(check.status)}</em></article>`).join("");
  byId("readinessStrategyList").innerHTML = data.strategies.length ? data.strategies.map((strategy) => `<article class="readiness-strategy"><div><strong>${escapeHtml(strategy.symbol)}</strong><span>#${strategy.id} · ${strategy.status}</span></div><dl><div><dt>დაკვირვება</dt><dd>${strategy.observationHours.toFixed(1)} სთ</dd></div><div><dt>BUY / SELL</dt><dd>${strategy.buyCount} / ${strategy.sellCount}</dd></div><div><dt>სრული ციკლი</dt><dd>${strategy.completedCycles}</dd></div><div><dt>ბიუჯეტი</dt><dd>${strategy.budgetUsedPercent.toFixed(1)}%</dd></div><div><dt>EXECUTING / FAILED</dt><dd class="${strategy.pendingExecutionCount || strategy.failedLevelCount ? "negative" : "positive"}">${strategy.pendingExecutionCount} / ${strategy.failedLevelCount}</dd></div></dl></article>`).join("") : '<p class="empty-state">Testnet სტრატეგია ჯერ არ არის</p>';
  byId("readinessUpdated").textContent = `განახლდა ${new Date(data.generatedAt).toLocaleTimeString("ka-GE")}`;
}

async function loadReadiness() {
  byId("refreshReadiness").disabled = true;
  try {
    const [readiness, telegram] = await Promise.all([api("/api/readiness"), api("/api/telegram/status")]);
    renderReadiness(readiness);
    renderTelegramStatus(telegram);
  }
  catch (error) { showError(error); }
  finally { byId("refreshReadiness").disabled = false; }
}

function renderTelegramStatus(status) {
  const element = byId("telegramStatus");
  element.className = status.configured && !status.lastError ? "telegram-state ok" : "telegram-state error";
  element.textContent = !status.configured ? "Telegram: კონფიგურაცია ვერ მოიძებნა"
    : status.lastError ? `Telegram: ${status.lastError}`
      : status.lastSentAt ? `Telegram: გაიგზავნა ${new Date(status.lastSentAt).toLocaleTimeString("ka-GE")}` : "Telegram: მზადაა ტესტისთვის";
}

async function testTelegram() {
  byId("testTelegram").disabled = true;
  try {
    const result = await api("/api/telegram/test", { method: "POST" });
    renderTelegramStatus(result);
  } catch (error) { showError(error); }
  finally { byId("testTelegram").disabled = false; }
}

function openReadiness({ historyMode = "push" } = {}) {
  setVisibleView("readinessView");
  if (historyMode !== "none") updateNavigationState("readinessView", null, historyMode);
  void loadReadiness();
}

function renderMarket(market, tickSize = null) {
  const priceElement = byId("currentPrice");
  const changeElement = byId("priceChange");
  if (!market) {
    priceElement.textContent = "—";
    changeElement.textContent = "ცვლილებას ელოდება";
    changeElement.className = "price-change neutral";
    return;
  }
  priceElement.textContent = formatPrice(market.price, tickSize);
  if (previousMarketPrice !== null) {
    const difference = market.price - previousMarketPrice;
    const percent = previousMarketPrice === 0 ? 0 : difference / previousMarketPrice * 100;
    const direction = difference > 0 ? "up" : difference < 0 ? "down" : "neutral";
    const marker = difference > 0 ? "▲" : difference < 0 ? "▼" : "•";
    const sign = difference > 0 ? "+" : "";
    priceElement.className = direction === "neutral" ? "" : direction;
    changeElement.className = `price-change ${direction}`;
    changeElement.textContent = `${marker} ${formatSignedPrice(difference, tickSize)} (${sign}${percent.toFixed(3)}%)`;
  }
  previousMarketPrice = market.price;
}

function renderDetail(data) {
  const { strategy, orders } = data;
  const tickSize = data.symbolRules?.tickSize ?? null;
  const levels = data.levels.filter((level) => level.side === "BUY");
  const sellLevels = data.levels.filter((level) => level.side === "SELL");
  selectedStrategyStatus = strategy.status;
  selectedStrategy = strategy;
  selectedStrategyData = data;
  byId("mode").textContent = strategy.executionEnvironment;
  byId("symbol").textContent = strategy.symbol;
  byId("status").textContent = labelStatus(strategy.status);
  byId("toggleStatus").classList.toggle("paused", strategy.status === "PAUSED");
  byId("toggleStatus").hidden = strategy.status === "COMPLETED";
  byId("strategyActions").hidden = strategy.status === "COMPLETED";
  byId("strategyEnvironment").textContent = `სტრატეგიის გარემო: ${strategy.executionEnvironment}`;
  byId("resetStrategy").hidden = strategy.executionEnvironment !== "SIMULATION";
  byId("initialPrice").textContent = formatPrice(strategy.initialEntryPrice, tickSize);
  renderMarket(data.market, tickSize);
  updateLiveChart(data.market);
  byId("marketStatus").textContent = data.market ? `Binance · ${new Date(data.market.updatedAt).toLocaleTimeString("ka-GE")}` : "WebSocket ელოდება";
  byId("averageEntry").textContent = strategy.averageEntryPrice ? formatPrice(strategy.averageEntryPrice, tickSize) : "—";
  byId("invested").textContent = money.format(strategy.totalInvested);
  byId("remaining").textContent = money.format(data.remainingBudget);
  byId("totalBudget").textContent = `სულ ${money.format(strategy.totalBudget)}`;
  byId("assetQuantity").textContent = number.format(strategy.totalAssetQuantity);
  byId("simulatedAssetLabel").textContent = `${strategy.baseAsset} · მხოლოდ სტრატეგიის აღრიცხვა`;
  byId("saleProceeds").textContent = money.format(strategy.totalSaleProceeds);
  byId("soldQuantity").textContent = `გაყიდულია ${number.format(strategy.totalSoldQuantity)} ${strategy.baseAsset}`;
  byId("realizedProfit").textContent = money.format(strategy.realizedProfit);
  byId("realizedProfit").className = strategy.realizedProfit > 0 ? "positive" : strategy.realizedProfit < 0 ? "negative" : "";
  const availableProfit = data.profitWithdrawal?.availableProfit ?? 0;
  const minimumWithdrawal = strategy.executionEnvironment === "TESTNET" ? Number(data.symbolRules?.minNotional ?? 0) : 0;
  byId("withdrawnProfit").textContent = money.format(strategy.withdrawnProfit ?? 0);
  byId("withdrawnProfitTotal").textContent = `სულ აღებული: ${money.format(strategy.withdrawnProfit ?? 0)}`;
  byId("availableProfit").textContent = `ხელმისაწვდომი: ${money.format(availableProfit)}${minimumWithdrawal > 0 ? ` · მინ. ${money.format(minimumWithdrawal)}` : ""}`;
  const withdrawButton = byId("withdrawProfit");
  withdrawButton.hidden = strategy.status === "COMPLETED" || strategy.totalAssetQuantity <= 0;
  withdrawButton.disabled = availableProfit <= 0 || availableProfit + 0.00000001 < minimumWithdrawal;
  withdrawButton.title = withdrawButton.disabled && minimumWithdrawal > 0
    ? `Binance-ზე მინიმუმ ${money.format(minimumWithdrawal)} მოგება უნდა დაგროვდეს`
    : "ხელმისაწვდომი მოგების აღება";
  const reserveQuantity = strategy.totalPurchasedQuantity * (strategy.finalReservePercent / 100);
  byId("reserveQuantity").textContent = `${number.format(reserveQuantity)} ${strategy.baseAsset}`;
  byId("reserveQuantity").nextElementSibling.textContent = `ნაყიდი რაოდენობის ${strategy.finalReservePercent}%`;
  byId("budgetShare").textContent = `${data.progressPercent.toFixed(0)}% გამოყენებულია`;
  byId("progressLabel").textContent = `${data.progressPercent.toFixed(0)}%`;
  byId("progressBar").style.width = `${Math.min(100, data.progressPercent)}%`;

  const rules = data.symbolRules;
  byId("rulePair").textContent = `${strategy.baseAsset} / ${strategy.quoteAsset}`;
  byId("ruleStatus").textContent = rules?.status === "TRADING" ? "ვაჭრობა აქტიურია" : rules?.status ?? "ელოდება";
  byId("minQty").textContent = rules?.minQty ?? "—";
  byId("stepSize").textContent = rules?.stepSize ?? "—";
  byId("tickSize").textContent = rules?.tickSize ?? "—";
  byId("minNotional").textContent = rules ? `${rules.minNotional} ${strategy.quoteAsset}` : "—";

  const balances = data.account?.balances ?? [];
  const quoteBalance = balances.find((balance) => balance.asset === strategy.quoteAsset);
  const coinBalance = balances.find((balance) => balance.asset === strategy.baseAsset);
  const connection = data.account?.connection;
  byId("accountTitle").textContent = strategy.executionEnvironment === "TESTNET" ? "Binance Spot Testnet ანგარიში" : "Binance Spot ანგარიში";
  byId("accountSubtitle").textContent = strategy.executionEnvironment === "TESTNET" ? "სატესტო თანხის ბალანსები და შესრულებული ორდერები" : "ბალანსები მხოლოდ წაკითხვის რეჟიმში";
  const isConnected = connection?.status === "CONNECTED";
  const accountPanel = document.querySelector(".account-panel");
  accountPanel.classList.toggle("connected", isConnected);
  accountPanel.classList.toggle("connection-error", Boolean(connection && !["CONNECTED", "CONNECTING", "NOT_CONFIGURED"].includes(connection.status)));
  byId("accountStatus").textContent = isConnected ? "დაკავშირებულია" : connection ? labelConnection(connection.status) : "არ არის დაკავშირებული";
  byId("quoteBalanceLabel").textContent = `${strategy.quoteAsset} ხელმისაწვდომი ბალანსი`;
  byId("availableUsdt").textContent = quoteBalance ? `${number.format(Number(quoteBalance.free))} ${quoteBalance.asset}` : "—";
  byId("quoteLocked").textContent = quoteBalance ? `დაბლოკილი: ${number.format(Number(quoteBalance.locked))}` : "დაბლოკილი: —";
  byId("coinBalanceLabel").textContent = `${strategy.baseAsset} ხელმისაწვდომი ბალანსი`;
  byId("coinBalance").textContent = coinBalance ? `${number.format(Number(coinBalance.free))} ${coinBalance.asset}` : "—";
  byId("coinLocked").textContent = coinBalance ? `დაბლოკილი: ${number.format(Number(coinBalance.locked))}` : "დაბლოკილი: —";
  byId("connectionMessage").textContent = connection?.message ?? "—";
  byId("balanceUpdated").textContent = connection ? `განახლდა ${new Date(connection.updatedAt).toLocaleTimeString("ka-GE")}` : "განახლებას ელოდება";

  const executed = levels.filter((level) => level.status === "EXECUTED").length;
  byId("levelCount").textContent = `${executed} / ${levels.length}`;
  byId("levels").innerHTML = levels.map((level) => `<div class="level"><span class="level-badge buy-drop">-${level.levelPercent}%</span><div class="level-info"><strong>${formatPrice(level.triggerPrice, tickSize)}</strong><span>დარჩენილი ბიუჯეტის ${level.allocationPercent}%</span></div><span class="level-state ${level.status.toLowerCase()}">${labelStatus(level.status)}</span></div>`).join("");
  const executedSells = sellLevels.filter((level) => level.status === "EXECUTED").length;
  byId("sellLevelCount").textContent = `${executedSells} / ${sellLevels.length}`;
  byId("sellLevels").innerHTML = sellLevels.map((level) => `<div class="level"><span class="level-badge sell-gain">+${level.levelPercent}%</span><div class="level-info"><strong>${formatPrice(level.triggerPrice, tickSize)}</strong><span>ნაყიდი რაოდენობის ${level.allocationPercent}%</span></div><span class="level-state ${level.status.toLowerCase()}">${labelStatus(level.status)}</span></div>`).join("");
  byId("orders").innerHTML = orders.length ? orders.map((order) => `<tr><td><span class="order-environment">${order.executionEnvironment}</span></td><td><span class="${order.side === "BUY" ? "buy" : "sell"}">${order.levelPercent === 0 ? (order.side === "BUY" ? "საწყისი ყიდვა" : "მოგების აღება") : `${order.side === "BUY" ? "ყიდვა" : "გაყიდვა"} ${order.side === "BUY" ? "-" : "+"}${order.levelPercent}%`}</span></td><td>${formatPrice(order.marketPrice, tickSize)}</td><td>${money.format(order.quoteAmount)}</td><td class="quantity-cell ${order.side === "BUY" ? "positive" : "negative"}">${order.side === "BUY" ? "+" : "-"}${number.format(order.assetQuantity)}</td><td>${new Date(order.createdAt).toLocaleString("ka-GE", { dateStyle: "short", timeStyle: "short" })}</td></tr>`).join("") : '<tr><td colspan="6" class="empty">ორდერები ჯერ არ არის</td></tr>';
  byId("updatedAt").textContent = `განახლდა ${new Date(data.generatedAt).toLocaleTimeString("ka-GE")}`;
}

async function openDetail(id, { historyMode = "push" } = {}) {
  selectedStrategyId = id;
  previousMarketPrice = null;
  setVisibleView("detailView");
  if (historyMode !== "none") updateNavigationState("detailView", id, historyMode);
  try {
    renderDetail(await api(`/api/strategies/${id}`));
    await loadPriceChart(id);
  } catch (error) { showError(error); }
}

async function refreshDetail() {
  if (!selectedStrategyId) return;
  try {
    const data = await api(`/api/strategies/${selectedStrategyId}`);
    const ordersChanged = Boolean(candleSeries && data.orders.length !== chartOrderCount);
    renderDetail(data);
    if (ordersChanged) await loadPriceChart(selectedStrategyId);
  } catch (error) { showError(error); }
}

async function setStatus(id, status) {
  await api(`/api/strategies/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
}

function levelRow(side, level = {}) {
  const firstName = side === "BUY" ? "dropPercent" : "gainPercent";
  const secondName = side === "BUY" ? "budgetPercent" : "allocationPercent";
  const firstLabel = side === "BUY" ? "კლება %" : "ზრდა %";
  const secondLabel = side === "BUY" ? "ბიუჯეტი %" : "გასაყიდი %";
  return `<div class="level-editor-row" data-side="${side}"><label><span>${firstLabel}</span><input name="${firstName}" type="number" min="0.000001" step="any" value="${level[firstName] ?? ""}" required /></label><label><span>${secondLabel}</span><input name="${secondName}" type="number" min="0.000001" step="any" value="${level[secondName] ?? ""}" required /></label><button class="icon-button remove-level" type="button" title="დონის წაშლა">×</button></div>`;
}

function renderLevelEditor(side, levels) {
  const target = byId(side === "BUY" ? "buyLevelEditor" : "sellLevelEditor");
  target.innerHTML = levels.map((level) => levelRow(side, level)).join("");
  target.querySelectorAll(".remove-level").forEach((button) => button.addEventListener("click", () => {
    if (target.children.length <= 1) return;
    button.closest(".level-editor-row").remove();
    byId("templateSelect").value = "custom";
    validateLevelEditors();
  }));
  target.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
    if (!applyingTemplate) byId("templateSelect").value = "custom";
    validateLevelEditors();
  }));
}

function markOverflowingAllocations(rows, inputName, maximum, errorElement, label) {
  const inputs = rows.map((row) => row.querySelector(`[name="${inputName}"]`));
  inputs.forEach((input) => {
    input.classList.remove("field-invalid");
    input.removeAttribute("aria-invalid");
  });
  const values = inputs.map((input) => Number(input.value) || 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const overflow = total - maximum;
  if (overflow <= 1e-9) {
    errorElement.hidden = true;
    errorElement.textContent = "";
    return true;
  }
  let runningTotal = 0;
  let firstInvalidIndex = inputs.length - 1;
  for (let index = 0; index < values.length; index += 1) {
    runningTotal += values[index];
    if (runningTotal > maximum) { firstInvalidIndex = index; break; }
  }
  for (let index = firstInvalidIndex; index < inputs.length; index += 1) {
    inputs[index].classList.add("field-invalid");
    inputs[index].setAttribute("aria-invalid", "true");
  }
  const firstInvalidValue = values[firstInvalidIndex];
  const suggestedMaximum = Math.max(0, firstInvalidValue - overflow);
  errorElement.hidden = false;
  errorElement.textContent = `${label} ჯამია ${total}%, დაშვებულია მაქსიმუმ ${maximum}%. წითლად მონიშნული ველი ${firstInvalidValue}%-დან ${suggestedMaximum}%-მდე შეამცირე (სულ ${overflow}%-ით).`;
  return false;
}

function validateLevelEditors() {
  const buyRows = [...byId("buyLevelEditor").querySelectorAll(".level-editor-row")];
  const sellRows = [...byId("sellLevelEditor").querySelectorAll(".level-editor-row")];
  const reserve = Number(byId("finalReservePercent").value) || 0;
  const buysValid = markOverflowingAllocations(buyRows, "budgetPercent", 100, byId("buyLevelError"), "BUY ბიუჯეტის განაწილება");
  const sellsValid = markOverflowingAllocations(sellRows, "allocationPercent", Math.max(0, 100 - reserve), byId("sellLevelError"), `SELL განაწილება (${reserve}% რეზერვით)`);
  return buysValid && sellsValid;
}

function readLevelEditor(side) {
  const target = byId(side === "BUY" ? "buyLevelEditor" : "sellLevelEditor");
  return [...target.querySelectorAll(".level-editor-row")].map((row) => side === "BUY" ? {
    dropPercent: Number(row.querySelector('[name="dropPercent"]').value),
    budgetPercent: Number(row.querySelector('[name="budgetPercent"]').value),
  } : {
    gainPercent: Number(row.querySelector('[name="gainPercent"]').value),
    allocationPercent: Number(row.querySelector('[name="allocationPercent"]').value),
  });
}

function applyTemplate(template) {
  applyingTemplate = true;
  renderLevelEditor("BUY", template.buyLevels);
  renderLevelEditor("SELL", template.sellLevels);
  byId("finalReservePercent").value = template.finalReservePercent;
  byId("deleteTemplate").hidden = template.builtIn || template.id == null;
  applyingTemplate = false;
  validateLevelEditors();
}

async function loadTemplates(force = false) {
  if (strategyTemplates.length && !force) return;
  strategyTemplates = (await api("/api/strategy-templates")).templates;
  const select = byId("templateSelect");
  select.innerHTML = `${strategyTemplates.map((template, index) => `<option value="template:${index}">${template.builtIn ? "მზა · " : "ჩემი · "}${template.name}</option>`).join("")}<option value="custom">Custom პარამეტრები</option>`;
}

function prepareCreateForm(strategy = null) {
  editingStrategyId = strategy?.id ?? null;
  const form = byId("createForm");
  form.reset();
  form.elements.executionEnvironment.disabled = false;
  byId("formError").hidden = true;
  byId("formTitle").textContent = strategy ? "სტრატეგიის რედაქტირება" : "სტრატეგიის შექმნა";
  byId("formSubtitle").textContent = strategy
    ? "რედაქტირებამდე სტრატეგია უნდა იყოს შეჩერებული და შეუსრულებელი"
    : "მხოლოდ აქტიური Binance Spot USDT წყვილები";
  byId("formSubmit").textContent = strategy ? "ცვლილებების შენახვა" : "სტრატეგიის შექმნა";
  byId("saveAsTemplate").checked = false;
  byId("templateNameLabel").hidden = true;
  byId("templateName").value = "";
  byId("customStrategySettings").open = Boolean(strategy);
  selectedSymbolMarketPrice = null;
  byId("initialPriceHint").hidden = true;
  if (strategy) {
    form.elements.symbol.value = strategy.symbol;
    form.elements.initialEntryPrice.value = strategy.initialEntryPrice;
    form.elements.totalBudget.value = strategy.totalBudget;
    form.elements.initialPurchaseAmount.value = strategy.initialPurchaseAmount ?? 0;
    form.elements.executionEnvironment.value = strategy.executionEnvironment;
    form.elements.executionEnvironment.disabled = true;
    const buyLevels = selectedStrategyData.levels.filter((level) => level.side === "BUY")
      .map((level) => ({ dropPercent: level.levelPercent, budgetPercent: level.allocationPercent }));
    const sellLevels = selectedStrategyData.levels.filter((level) => level.side === "SELL")
      .map((level) => ({ gainPercent: level.levelPercent, allocationPercent: level.allocationPercent }));
    byId("templateSelect").value = "custom";
    applyTemplate({ buyLevels, sellLevels, finalReservePercent: strategy.finalReservePercent, builtIn: true, id: null });
    byId("deleteTemplate").hidden = true;
  } else if (strategyTemplates.length) {
    form.elements.executionEnvironment.disabled = false;
    byId("templateSelect").value = "template:1";
    applyTemplate(strategyTemplates[1] ?? strategyTemplates[0]);
  }
  updateInitialPurchaseHint();
}

async function loadSymbols() {
  if (symbolsLoaded) return;
  const { symbols } = await api("/api/symbols");
  const options = byId("symbolOptions");
  availableSymbols = new Set(symbols.map((item) => item.symbol));
  options.replaceChildren(...symbols.map((item) => {
    const option = document.createElement("option");
    option.value = item.symbol;
    option.label = `${item.baseAsset} / USDT`;
    return option;
  }));
  symbolsLoaded = true;
}

function showError(error) {
  byId("error").textContent = error.message;
  byId("error").hidden = false;
}

byId("openCreate").addEventListener("click", async () => {
  byId("createDialog").showModal();
  try { await Promise.all([loadSymbols(), loadTemplates()]); prepareCreateForm(); } catch (error) { byId("formError").textContent = error.message; byId("formError").hidden = false; }
});
byId("brandHome").addEventListener("click", () => {
  if (!byId("overviewView").hidden) void loadOverview();
  else showOverview();
});
byId("openComparison").addEventListener("click", () => { void openComparison(); });
byId("openMarketCandidates").addEventListener("click", openMarketCandidates);
byId("openNews").addEventListener("click", openNews);
byId("openReadiness").addEventListener("click", openReadiness);
byId("refreshReadiness").addEventListener("click", loadReadiness);
byId("testTelegram").addEventListener("click", testTelegram);
byId("comparisonSymbol").addEventListener("change", (event) => { void loadComparison(event.target.value); });
byId("comparisonCreate").addEventListener("click", () => { void openCreateForComparison(); });
byId("backtestRange").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
  backtestDays = Number(button.dataset.days);
  byId("backtestRange").querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button));
}));
byId("runBacktest").addEventListener("click", () => { void runBacktest(); });
byId("backFromComparison").addEventListener("click", () => {
  backToPreviousView();
});
byId("backFromMarketCandidates").addEventListener("click", () => {
  backToPreviousView();
});
byId("backFromNews").addEventListener("click", () => {
  backToPreviousView();
});
byId("backFromReadiness").addEventListener("click", () => {
  backToPreviousView();
});
byId("closeCreate").addEventListener("click", () => byId("createDialog").close());
byId("backToStrategies").addEventListener("click", () => {
  backToPreviousView();
});
byId("showActive").addEventListener("click", () => {
  showingArchived = false;
  byId("showActive").classList.add("selected");
  byId("showArchived").classList.remove("selected");
  void loadOverview();
});
byId("showArchived").addEventListener("click", () => {
  showingArchived = true;
  byId("showArchived").classList.add("selected");
  byId("showActive").classList.remove("selected");
  void loadOverview();
});
byId("showBuyLevels").addEventListener("click", () => showLevelView("BUY"));
byId("showSellLevels").addEventListener("click", () => showLevelView("SELL"));
byId("themeToggle").addEventListener("click", () => applyTheme(isDarkTheme() ? "light" : "dark"));
byId("refreshOpportunities").addEventListener("click", loadOpportunities);
byId("refreshNews").addEventListener("click", loadNews);
byId("newsDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
byId("newsSource").addEventListener("change", renderNews);
byId("newsSentiment").addEventListener("change", renderNews);
byId("candidateLayout").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
  applyCandidateLayout(button.dataset.layout);
}));
byId("openUsers").addEventListener("click", async () => {
  byId("usersDialog").showModal();
  byId("inviteResult").hidden = true;
  try {
    const { users } = await api("/api/admin/users");
    byId("usersList").innerHTML = users.map((user) => `<div class="user-row"><strong>${user.username}</strong><span>${user.role} · ${user.strategyCount} სტრატეგია</span></div>`).join("");
  } catch (error) { showError(error); }
});
byId("closeUsers").addEventListener("click", () => byId("usersDialog").close());
byId("createInvite").addEventListener("click", async () => {
  try {
    const { invite } = await api("/api/admin/invites", { method: "POST" });
    byId("inviteResult").hidden = false;
    byId("inviteResult").innerHTML = `<strong>${invite.code}</strong><br><span>მოქმედებს ${new Date(invite.expiresAt).toLocaleString("ka-GE")}-მდე და გამოიყენება მხოლოდ ერთხელ.</span>`;
  } catch (error) { showError(error); }
});
byId("chartRange").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
  if (selectedStrategyId) void loadPriceChart(selectedStrategyId, button.dataset.range);
}));
byId("symbolSearch").addEventListener("change", () => { void useCurrentSymbolPrice(); });
byId("symbolSearch").addEventListener("blur", () => { void useCurrentSymbolPrice(); });
byId("initialEntryPrice").addEventListener("input", updateInitialPriceHint);
byId("executionEnvironment").addEventListener("change", () => { void useCurrentSymbolPrice(); });
byId("initialPurchaseAmount").addEventListener("input", updateInitialPurchaseHint);
byId("createForm").elements.totalBudget.addEventListener("input", updateInitialPurchaseHint);
byId("toggleStatus").addEventListener("click", async () => {
  if (!selectedStrategyId) return;
  await setStatus(selectedStrategyId, selectedStrategyStatus === "ACTIVE" ? "PAUSED" : "ACTIVE");
  await refreshDetail();
});
byId("editStrategy").addEventListener("click", async () => {
  if (!selectedStrategy) return;
  byId("createDialog").showModal();
  try { await Promise.all([loadSymbols(), loadTemplates()]); prepareCreateForm(selectedStrategy); } catch (error) { byId("formError").textContent = error.message; byId("formError").hidden = false; }
});
byId("resetStrategy").addEventListener("click", async () => {
  if (!selectedStrategyId || !confirm("განულებისას მიმდინარე ციკლი არქივში გადავა და შეიქმნება ახალი სუფთა SIMULATION სტრატეგია. გავაგრძელოთ?")) return;
  try {
    const result = await api(`/api/strategies/${selectedStrategyId}/reset`, { method: "POST" });
    await openDetail(result.strategy.id, { historyMode: "replace" });
  } catch (error) { showError(error); }
});
byId("withdrawProfit").addEventListener("click", async () => {
  if (!selectedStrategyId || !selectedStrategyData) return;
  const available = selectedStrategyData.profitWithdrawal?.availableProfit ?? 0;
  const defaultAmount = Math.floor(available * 100) / 100;
  const value = prompt(`ხელმისაწვდომი მოგება: ${money.format(available)}\nრამდენი USDT-ის აღება გინდა?`, defaultAmount.toFixed(2));
  if (value === null) return;
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return showError(new Error("სწორი თანხა შეიყვანე"));
  if (!confirm(`${money.format(amount)} მოგების მისაღებად გაიყიდება შესაბამისი ${selectedStrategy.baseAsset}. გაგრძელდეს?`)) return;
  try {
    await api(`/api/strategies/${selectedStrategyId}/withdraw-profit`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }),
    });
    await refreshDetail();
  } catch (error) { showError(error); }
});
byId("archiveStrategy").addEventListener("click", async () => {
  if (!selectedStrategyId || !confirm("სტრატეგია დასრულდება და არქივში გადავა. ისტორია არ წაიშლება. გავაგრძელოთ?")) return;
  try {
    await api(`/api/strategies/${selectedStrategyId}/archive`, { method: "POST" });
    showOverview({ historyMode: "replace" });
  } catch (error) { showError(error); }
});
byId("createForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  byId("formError").hidden = true;
  if (!validateLevelEditors()) {
    byId("customStrategySettings").open = true;
    byId("formError").textContent = "გაასწორე წითლად მონიშნული პროცენტული ველი.";
    byId("formError").hidden = false;
    return;
  }
  try {
    const buyLevels = readLevelEditor("BUY");
    const sellLevels = readLevelEditor("SELL");
    const finalReservePercent = Number(byId("finalReservePercent").value);
    if (byId("saveAsTemplate").checked) {
      await api("/api/strategy-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: byId("templateName").value, buyLevels, sellLevels, finalReservePercent }),
      });
      strategyTemplates = [];
    }
    const endpoint = editingStrategyId ? `/api/strategies/${editingStrategyId}` : "/api/strategies";
    const executionEnvironment = form.get("executionEnvironment") || selectedStrategy?.executionEnvironment || "SIMULATION";
    if (!editingStrategyId && executionEnvironment === "TESTNET" && !confirm("ეს სტრატეგია Binance Spot Testnet-ზე რეალურ API ორდერებს გაგზავნის სატესტო თანხით. გაგრძელდეს?")) return;
    const result = await api(endpoint, {
      method: editingStrategyId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: form.get("symbol"), initialEntryPrice: form.get("initialEntryPrice"), totalBudget: form.get("totalBudget"), initialPurchaseAmount: form.get("initialPurchaseAmount") || 0, executionEnvironment, buyLevels, sellLevels, finalReservePercent }),
    });
    byId("createDialog").close();
    event.currentTarget.reset();
    editingStrategyId = null;
    await loadOverview();
    await openDetail(result.strategy.id);
  } catch (error) { byId("formError").textContent = error.message; byId("formError").hidden = false; }
});

byId("templateSelect").addEventListener("change", (event) => {
  if (event.target.value === "custom") {
    byId("deleteTemplate").hidden = true;
    byId("customStrategySettings").open = true;
    return;
  }
  const index = Number(event.target.value.split(":")[1]);
  applyTemplate(strategyTemplates[index]);
  byId("customStrategySettings").open = false;
});
byId("addBuyLevel").addEventListener("click", () => {
  renderLevelEditor("BUY", [...readLevelEditor("BUY"), { dropPercent: "", budgetPercent: "" }]);
  byId("templateSelect").value = "custom";
});
byId("addSellLevel").addEventListener("click", () => {
  renderLevelEditor("SELL", [...readLevelEditor("SELL"), { gainPercent: "", allocationPercent: "" }]);
  byId("templateSelect").value = "custom";
});
byId("finalReservePercent").addEventListener("input", () => {
  if (!applyingTemplate) byId("templateSelect").value = "custom";
  validateLevelEditors();
});
byId("saveAsTemplate").addEventListener("change", (event) => {
  byId("templateNameLabel").hidden = !event.target.checked;
  byId("templateName").required = event.target.checked;
});
byId("deleteTemplate").addEventListener("click", async () => {
  const index = Number(byId("templateSelect").value.split(":")[1]);
  const template = strategyTemplates[index];
  if (!template?.id || !confirm(`წაიშალოს შაბლონი „${template.name}“?`)) return;
  try {
    await api(`/api/strategy-templates/${template.id}`, { method: "DELETE" });
    strategyTemplates = [];
    await loadTemplates(true);
    byId("templateSelect").value = "template:1";
    applyTemplate(strategyTemplates[1] ?? strategyTemplates[0]);
  } catch (error) { byId("formError").textContent = error.message; byId("formError").hidden = false; }
});

applyTheme(document.documentElement.dataset.theme, false);
try { applyCandidateLayout(localStorage.getItem("spot-candidate-layout"), false); } catch { applyCandidateLayout("columns", false); }
window.history.replaceState({ ...(window.history.state ?? {}), appView: "overviewView", strategyId: null }, "", window.location.href);
window.addEventListener("popstate", (event) => {
  const view = event.state?.appView ?? "overviewView";
  if (view === "detailView" && Number.isInteger(Number(event.state?.strategyId))) void openDetail(Number(event.state.strategyId), { historyMode: "none" });
  else if (view === "comparisonView") void openComparison({ historyMode: "none" });
  else if (view === "marketCandidatesView") openMarketCandidates({ historyMode: "none" });
  else if (view === "newsView") openNews({ historyMode: "none" });
  else if (view === "readinessView") openReadiness({ historyMode: "none" });
  else showOverview({ historyMode: "none" });
});
api("/api/session").then(({ user }) => {
  sessionUser = user;
  byId("currentUser").textContent = user.username;
  byId("openUsers").hidden = user.role !== "ADMIN";
}).catch(showError);
loadOverview();
setInterval(() => {
  if (selectedStrategyId) return refreshDetail();
  if (!byId("overviewView").hidden) return loadOverview();
}, 3_000);
setInterval(() => {
  if (!byId("readinessView").hidden) void loadReadiness();
}, 30_000);
