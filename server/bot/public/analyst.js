(() => {
  const node = (id) => document.getElementById(id);
  const dialog = node("analystDialog");
  const labels = { UNKNOWN: "მონაცემი არასრულია", NORMAL: "გაფრთხილება არ ჩანს", CAUTION: "საყურადღებოა", HIGH: "გადასამოწმებელია" };
  const trends = { UP: "↑ აღმავალი", DOWN: "↓ დაღმავალი", RANGE: "↔ შერეული", UNKNOWN: "— არასრული" };
  const decisions = { NEW: "ახალი", ACKNOWLEDGED: "გაცნობილია", DISMISSED: "უარყოფილია" };
  let report = null;
  let reportKey = "";
  let lastLoaded = 0;
  let loading = false;
  let requestSequence = 0;
  let panelSequence = 0;
  let detailId = null;
  let history = [];
  let assessment = null;
  let returnFocus = null;
  let saving = false;
  let enabled = true;
  const preferences = new Map();

  const key = () => `${sessionUser?.username ?? "local"}:${selectedEnvironment}`;
  const preferenceKey = () => `spot-analyst:${sessionUser?.username ?? "local"}`;
  const percent = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
  const amount = (value) => Number.isFinite(value) ? money.format(value) : "—";
  const time = (value) => value ? new Date(value).toLocaleString("ka-GE", { timeZone: "Asia/Tbilisi", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
  const riskMarkup = (risk) => `<span class="analyst-risk ${String(risk).toLowerCase()}">${escapeHtml(labels[risk] ?? labels.UNKNOWN)}</span>`;

  function readPreference() {
    try { enabled = localStorage.getItem(preferenceKey()) !== "off"; } catch { enabled = preferences.get(preferenceKey()) ?? true; }
    node("toggleAnalyst").setAttribute("aria-checked", String(enabled));
    node("refreshAnalyst").disabled = !enabled;
  }

  function updateChips() {
    document.querySelectorAll("[data-analyst-id]").forEach((button) => {
      const item = enabled && reportKey === key() ? report?.assessments?.find((entry) => entry.strategyId === Number(button.dataset.analystId) && Date.now() - Date.parse(entry.generatedAt) < 60_000) : null;
      button.className = `analyst-chip ${item?.risk?.toLowerCase() ?? ""}`;
      button.textContent = item ? labels[item.risk] : "ანალიზი";
      button.disabled = !enabled;
    });
    node("openDetailAnalyst").disabled = !enabled;
  }

  function renderPulse() {
    if (!enabled) {
      node("analystPulse").innerHTML = '<p class="analyst-caption">ანალიტიკა გამორთულია</p>';
      node("analystUpdated").textContent = "ბოტების სავაჭრო რეჟიმი უცვლელია";
      node("openAnalystSummary").disabled = true;
      return;
    }
    if (!report || reportKey !== key()) return;
    node("analystPulse").innerHTML = (report.pulse ?? []).map((item) => `<div class="analyst-pulse-item"><div class="analyst-pulse-name"><strong>${escapeHtml(item.symbol.replace("USDT", ""))} / USDT</strong><span class="analyst-trend ${item.trend.toLowerCase()}">${escapeHtml(trends[item.trend] ?? trends.UNKNOWN)}</span></div><div class="analyst-pulse-metrics"><span>24ს ცვლილება<strong>${percent(item.change24h)}</strong></span><span>დღის დიაპაზონი<strong>${Number.isFinite(item.range24h) ? `${item.range24h.toFixed(2)}%` : "—"}</strong></span><span>ბრუნვა / წინა 24ს<strong>${percent(item.volumeChange)}</strong></span></div><span class="analyst-caption">${escapeHtml(item.source)} · ${item.asOf ? time(item.asOf) : "ისტორია მიუწვდომელია"}</span></div>`).join("");
    const flagged = report.assessments.filter((item) => item.risk === "HIGH" || item.risk === "UNKNOWN").length;
    node("analystUpdated").textContent = `შეფასდა ${report.assessments.length} ბოტი · ${flagged} გადასამოწმებელი${report.truncated ? " · ნაჩვენებია პირველი 30" : ""}`;
    node("openAnalystSummary").disabled = !report.assessments.length;
  }

  async function load(force = false) {
    readPreference();
    if (!enabled) { renderPulse(); updateChips(); return; }
    const context = key();
    if (reportKey !== context) {
      report = null;
      lastLoaded = 0;
      node("analystPulse").innerHTML = '<p class="analyst-caption">ბაზრის მონაცემები მოწმდება...</p>';
      node("openAnalystSummary").disabled = true;
    }
    updateChips();
    if ((loading && reportKey === context) || (!force && Date.now() - lastLoaded < 30_000)) return;
    const sequence = ++requestSequence;
    reportKey = context;
    loading = true;
    lastLoaded = Date.now();
    node("refreshAnalyst").disabled = true;
    try {
      const data = await api(`/api/analyst/overview?environment=${encodeURIComponent(selectedEnvironment)}`);
      if (sequence !== requestSequence || context !== key() || !enabled) return;
      if (!Array.isArray(data.pulse) || !Array.isArray(data.assessments) || data.environment !== selectedEnvironment) throw new Error("შეფასება ჯერ მიუწვდომელია");
      report = data;
      lastLoaded = Date.now();
      renderPulse();
      updateChips();
    } catch {
      if (sequence === requestSequence && context === key()) {
        report = null;
        updateChips();
        node("analystPulse").innerHTML = '<p class="analyst-caption">ბაზრის ანალიზი დროებით მიუწვდომელია</p>';
        node("analystUpdated").textContent = "შეფასება ვერ განახლდა";
      }
    } finally {
      if (sequence === requestSequence) { loading = false; node("refreshAnalyst").disabled = !enabled; }
    }
  }

  function selectTab(name) {
    const current = name === "current";
    node("analystCurrent").hidden = !current;
    node("analystHistory").hidden = current;
    node("analystCurrentTab").setAttribute("aria-selected", String(current));
    node("analystHistoryTab").setAttribute("aria-selected", String(!current));
    node("analystCurrentTab").tabIndex = current ? 0 : -1;
    node("analystHistoryTab").tabIndex = current ? -1 : 0;
    node("saveAnalystReview").hidden = !current;
  }

  function showDialog() {
    if (!dialog.open) {
      returnFocus = document.activeElement;
      if (!window.history.state?.analystOpen) window.history.pushState({ ...(window.history.state ?? {}), analystOpen: true, analystStrategy: detailId }, "", window.location.href);
      dialog.showModal();
    }
    document.body.classList.add("analyst-open");
    node("analystMessage").textContent = "";
    dialog.scrollTop = 0;
  }

  function renderAssessment(item, historical = false) {
    assessment = item;
    const metrics = item.metrics;
    node("analystCurrent").innerHTML = `<div class="analyst-verdict">${riskMarkup(item.risk)}<h3>${escapeHtml(item.headline)}</h3><p>${escapeHtml(item.summary)}</p><span class="analyst-caption">${historical ? "შენახული შეფასება" : "შეფასებულია"} · ${time(item.generatedAt)} · ${escapeHtml(item.environment)}</span></div>
      <dl class="analyst-data"><div><dt>თავისუფალი USDT</dt><dd>${amount(metrics.freeQuote)}</dd></div><div><dt>საერთო შედეგი</dt><dd>${amount(metrics.pnl)}</dd></div><div><dt>კაპიტალის გამოყენება</dt><dd>${Number.isFinite(metrics.capitalUsedPercent) ? `${metrics.capitalUsedPercent.toFixed(1)}%` : "—"}</dd></div><div><dt>24ს ბაზრის ცვლილება</dt><dd>${percent(item.market.change24h)}</dd></div></dl>
      <h3 class="analyst-section-title">რის საფუძველზე</h3><ul class="analyst-facts">${item.facts.map((fact) => `<li class="${fact.severity.toLowerCase()}">${escapeHtml(fact.text)}</li>`).join("")}</ul>
      <div class="analyst-proposal"><h3 class="analyst-section-title">განსახილველი ნაბიჯი</h3><h4>${escapeHtml(item.suggestion.title)}</h4><p>${escapeHtml(item.suggestion.reason)}</p><p><strong>გასათვალისწინებელია:</strong> ${escapeHtml(item.suggestion.tradeoff)}</p></div>
      <p class="analyst-caption">ფასი: ${metrics.priceAt ? time(metrics.priceAt) : "არ არის"} · ისტორია: ${item.market.asOf ? time(item.market.asOf) : "არ არის"}</p>`;
    node("saveAnalystReview").disabled = historical || saving;
  }

  function renderHistory() {
    node("analystHistory").innerHTML = history.length ? history.map((review) => `<article class="analyst-history-item"><span class="analyst-caption">${time(review.assessment.generatedAt)} · ${escapeHtml(decisions[review.decision] ?? "—")} · წესები</span><h3>${escapeHtml(review.assessment.headline)}</h3>${riskMarkup(review.assessment.risk)}<div class="analyst-history-actions"><button class="analyst-text-button" type="button" data-history-review="${review.id}">დეტალები</button>${review.decision === "NEW" ? `<button class="analyst-text-button" type="button" data-review-decision="ACKNOWLEDGED" data-review-id="${review.id}">გავეცანი</button><button class="analyst-text-button" type="button" data-review-decision="DISMISSED" data-review-id="${review.id}">უარყოფა</button>` : ""}</div></article>`).join("") : '<p class="analyst-caption">შენახული შეფასებები ჯერ არ არის</p>';
  }

  window.openAnalyst = async (id) => {
    detailId = id;
    const sequence = ++panelSequence;
    const context = key();
    node("analystDialogTitle").textContent = "ბოტის ანალიზი";
    dialog.querySelector(".analyst-tabs").hidden = false;
    selectTab("current");
    node("analystCurrent").innerHTML = '<p class="analyst-caption">ბოტის მონაცემები მოწმდება...</p>';
    node("saveAnalystReview").disabled = true;
    showDialog();
    try {
      const data = await api(`/api/analyst/strategies/${id}`);
      if (sequence !== panelSequence || context !== key() || !dialog.open) return;
      node("analystDialogTitle").textContent = data.assessment.symbol;
      history = data.history ?? [];
      renderAssessment(data.assessment);
      renderHistory();
    } catch {
      if (sequence === panelSequence) node("analystCurrent").innerHTML = '<p class="analyst-caption">შეფასება ვერ ჩაიტვირთა. მოგვიანებით სცადე.</p>';
    }
  };

  node("openAnalystSummary").addEventListener("click", () => {
    if (!report || reportKey !== key()) return;
    detailId = null;
    panelSequence++;
    node("analystDialogTitle").textContent = "ბოტების შეფასებები";
    dialog.querySelector(".analyst-tabs").hidden = true;
    selectTab("current");
    node("saveAnalystReview").disabled = true;
    node("analystCurrent").innerHTML = report.assessments.map((item) => `<button class="analyst-summary-row" type="button" data-open-analyst="${item.strategyId}"><span><strong>${escapeHtml(item.symbol)}</strong><small>${escapeHtml(item.headline)}</small></span>${riskMarkup(item.risk)}</button>`).join("");
    showDialog();
  });
  node("analystCurrent").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-analyst]");
    if (button) void window.openAnalyst(Number(button.dataset.openAnalyst));
  });
  node("saveAnalystReview").addEventListener("click", async () => {
    if (!detailId || saving) return;
    const id = detailId;
    const sequence = panelSequence;
    saving = true;
    node("saveAnalystReview").disabled = true;
    try {
      const data = await api(`/api/analyst/strategies/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (sequence !== panelSequence || !dialog.open) return;
      history = data.history;
      renderAssessment(data.assessment);
      renderHistory();
      node("analystMessage").textContent = "შეფასება შენახულია. სტრატეგიის პარამეტრები უცვლელია.";
    } catch { if (sequence === panelSequence) node("analystMessage").textContent = "შენახვა ვერ მოხერხდა"; }
    finally { saving = false; if (sequence === panelSequence) node("saveAnalystReview").disabled = false; }
  });
  node("analystHistory").addEventListener("click", async (event) => {
    const snapshot = event.target.closest("[data-history-review]");
    if (snapshot) {
      const review = history.find((item) => item.id === Number(snapshot.dataset.historyReview));
      if (review) { selectTab("current"); renderAssessment(review.assessment, true); }
      return;
    }
    const button = event.target.closest("[data-review-decision]");
    if (!button || !detailId) return;
    const sequence = panelSequence;
    button.disabled = true;
    try {
      const data = await api(`/api/analyst/strategies/${detailId}/reviews/${button.dataset.reviewId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: button.dataset.reviewDecision }) });
      if (sequence !== panelSequence) return;
      history = data.history;
      renderHistory();
      node("analystMessage").textContent = "სტატუსი შენახულია. სავაჭრო მოქმედება არ შესრულებულა.";
    } catch { if (sequence === panelSequence) { button.disabled = false; node("analystMessage").textContent = "სტატუსი ვერ შეინახა"; } }
  });
  node("analystCurrentTab").addEventListener("click", () => selectTab("current"));
  node("analystHistoryTab").addEventListener("click", () => selectTab("history"));
  dialog.querySelector(".analyst-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = node("analystCurrentTab").getAttribute("aria-selected") === "true";
    const next = event.key === "Home" ? "current" : event.key === "End" ? "history" : current ? "history" : "current";
    selectTab(next);
    node(next === "current" ? "analystCurrentTab" : "analystHistoryTab").focus();
  });
  node("closeAnalyst").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    panelSequence++;
    document.body.classList.remove("analyst-open");
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else document.querySelector(`[data-analyst-id="${detailId}"]`)?.focus({ preventScroll: true });
    if (window.history.state?.analystOpen) window.history.back();
  });
  window.addEventListener("popstate", (event) => {
    if (dialog.open && !event.state?.analystOpen) dialog.close();
    else if (!dialog.open && event.state?.analystOpen && Number.isInteger(event.state.analystStrategy)) void window.openAnalyst(event.state.analystStrategy);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientY < bounds.top || event.clientY > bounds.bottom || event.clientX < bounds.left || event.clientX > bounds.right) dialog.close();
  });
  node("openDetailAnalyst").addEventListener("click", () => { if (selectedStrategyId) void window.openAnalyst(selectedStrategyId); });
  node("refreshAnalyst").addEventListener("click", () => void load(true));
  node("toggleAnalyst").addEventListener("click", () => {
    enabled = !enabled;
    preferences.set(preferenceKey(), enabled);
    try { localStorage.setItem(preferenceKey(), enabled ? "on" : "off"); } catch {}
    node("toggleAnalyst").setAttribute("aria-checked", String(enabled));
    if (enabled) void load(true);
    else { requestSequence++; loading = false; renderPulse(); updateChips(); node("refreshAnalyst").disabled = true; }
  });
  window.addEventListener("spot:overview", () => void load());
  setInterval(() => { if (sessionUser && !node("overviewView").hidden && document.visibilityState === "visible") void load(); }, 30_000);
  if (sessionUser) void load();
})();
