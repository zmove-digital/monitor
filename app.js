(() => {
  "use strict";

  const body = document.body;
  const themeToggle = document.getElementById("theme-toggle");
  const soundToggle = document.getElementById("sound-toggle");
  const soundStatus = document.getElementById("sound-status");
  const modal = document.getElementById("site-modal");
  const domainInput = document.getElementById("site-domain");
  const domainError = document.getElementById("domain-error");
  const toastRegion = document.getElementById("toast-region");
  const visitorRows = document.getElementById("visitor-rows");
  const siteMenu = document.getElementById("site-menu");
  const authModal = document.getElementById("auth-modal");
  const authForm = document.getElementById("auth-form");
  const authEmail = document.getElementById("auth-email");
  const authPassword = document.getElementById("auth-password");
  const authMessage = document.getElementById("auth-message");
  const authButton = document.getElementById("auth-button");
  const domainStep = document.getElementById("domain-step");
  const verificationStep = document.getElementById("verification-step");
  const trackingStep = document.getElementById("tracking-step");
  const modalTitle = document.getElementById("modal-title");
  const modalIntro = document.getElementById("modal-intro");
  const modalProgress = document.getElementById("modal-progress");
  const modalStepLabel = document.getElementById("modal-step-label");
  const demoVisitors = [
    { flag: "🇧🇷", city: "São Paulo", country: "Brasil", page: "/produtos/novidades", duration: "1m 24s", provider: "Vivo" },
    { flag: "🇧🇷", city: "Curitiba", country: "Brasil", page: "/colecao/verao", duration: "48s", provider: "Claro" },
    { flag: "🇵🇹", city: "Lisboa", country: "Portugal", page: "/sobre-nos", duration: "3m 06s", provider: "MEO" },
  ];
  let audioContext;
  const supabase = window.VIGIA_SUPABASE;
  let authMode = "login";
  let authSession = null;
  let userSites = [];
  let activeSiteId = null;
  let pendingSiteId = null;
  let pendingDomain = "";
  let lastPresenceSiteId = null;
  let knownVisitorIds = new Set();
  let soundEnabled = false;

  const showToast = (title, message, warning = false) => {
    const toast = document.createElement("div");
    toast.className = "toast";
    const indicator = document.createElement("span");
    indicator.className = `toast-indicator${warning ? " warning" : ""}`;
    const content = document.createElement("span");
    const heading = document.createElement("strong");
    const detail = document.createElement("span");
    heading.textContent = title;
    detail.textContent = message;
    content.append(heading, detail);
    toast.append(indicator, content);
    toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 5000);
  };

  const restoreTheme = () => {
    let savedTheme = null;
    try {
      savedTheme = window.localStorage.getItem("vigia-theme");
    } catch {
      // Storage may be disabled; fall back to the operating system preference.
    }
    const dark = savedTheme ? savedTheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    body.classList.toggle("dark", dark);
    themeToggle.setAttribute("aria-label", dark ? "Ativar tema claro" : "Ativar tema escuro");
  };

  const persist = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      showToast("Preferência não salva", "O armazenamento local está indisponível neste navegador.", true);
    }
  };

  const clearSession = () => {
    authSession = null;
    try {
      sessionStorage.removeItem("vigia-session");
    } catch {
      // Session storage is optional; the signed-in state is cleared in memory.
    }
  };

  const saveSession = (session) => {
    authSession = session;
    try {
      sessionStorage.setItem("vigia-session", JSON.stringify(session));
    } catch {
      showToast("Sessão não persistida", "A sessão ficará disponível apenas até esta página ser fechada.", true);
    }
  };

  const supabaseRequest = async (path, { method = "GET", body, accessToken, headers = {} } = {}) => {
    if (!supabase?.url || !supabase?.publishableKey) {
      throw new Error("A configuração pública do Supabase está ausente.");
    }
    const response = await fetch(`${supabase.url}${path}`, {
      method,
      headers: {
        apikey: supabase.publishableKey,
        Authorization: `Bearer ${accessToken || supabase.publishableKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const responseText = await response.text();
    let responseData = null;
    if (responseText) {
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { message: responseText };
      }
    }
    if (!response.ok) {
      if (response.status === 401 && authSession) clearSession();
      const error = new Error(responseData?.msg || responseData?.message || responseData?.error_description || `Supabase retornou HTTP ${response.status}.`);
      error.status = response.status;
      error.code = responseData?.code;
      throw error;
    }
    return responseData;
  };

  const getSession = async () => {
    if (authSession?.access_token && authSession.expires_at * 1000 > Date.now() + 30_000) {
      return authSession;
    }
    if (!authSession?.refresh_token) return null;
    try {
      const refreshed = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: authSession.refresh_token },
      });
      saveSession({ ...refreshed, expires_at: Date.now() / 1000 + (refreshed.expires_in || 3600) });
      return authSession;
    } catch {
      clearSession();
      return null;
    }
  };

  const setAuthenticatedUi = (user) => {
    authButton.textContent = user ? "Sair" : "Entrar";
    authButton.setAttribute("aria-label", user ? `Sair de ${user.email}` : "Entrar na conta Vigia");
    const profileName = document.querySelector(".profile-button strong");
    const profileDetail = document.querySelector(".profile-button small");
    profileName.textContent = user ? (user.email.split("@")[0] || "Minha conta") : "Meu espaço";
    profileDetail.textContent = user ? user.email : "Entre para conectar sites";
    body.classList.toggle("authenticated", Boolean(user));
  };

  const renderSiteMenu = () => {
    siteMenu.replaceChildren();
    userSites.forEach((site) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = `site-menu-item${site.id === activeSiteId ? " selected" : ""}`;
      const title = document.createElement("strong");
      title.textContent = site.domain;
      const status = document.createElement("span");
      status.textContent = site.verified_at ? "✓" : "·";
      status.setAttribute("aria-label", site.verified_at ? "Verificado" : "Não verificado");
      option.append(title, status);
      option.addEventListener("click", async () => {
        activeSiteId = site.id;
        siteMenu.hidden = true;
        updateSitePicker();
        await loadSiteAnalytics(site);
      });
      siteMenu.append(option);
    });
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "site-menu-item site-menu-add";
    addButton.textContent = "+ Adicionar outro site";
    addButton.addEventListener("click", () => {
      siteMenu.hidden = true;
      openModal();
    });
    siteMenu.append(addButton);
  };

  const updateSitePicker = () => {
    const activeSite = userSites.find((site) => site.id === activeSiteId);
    const name = document.getElementById("active-site-name");
    const domain = document.getElementById("active-site-domain");
    if (!activeSite) {
      name.textContent = userSites.length ? "Selecione um site" : "Adicione seu site";
      domain.textContent = userSites.length ? `${userSites.length} site(s) na conta` : "Nenhum site conectado";
      renderSiteMenu();
      return;
    }
    name.textContent = activeSite.verified_at ? activeSite.domain : `${activeSite.domain} · não verificado`;
    domain.textContent = "Conta Vigia";
    renderSiteMenu();
  };

  const renderEmptyVisitors = (message) => {
    visitorRows.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-data-cell";
    cell.textContent = message;
    row.append(cell);
    visitorRows.append(row);
  };

  const renderTrend = (events, days) => {
    const now = Date.now();
    const rangeMs = Number(days) * 24 * 60 * 60 * 1000;
    const bins = Array.from({ length: 7 }, () => ({ views: 0, sessions: new Set() }));
    events.filter((event) => event.event_type === "page_view").forEach((event) => {
      const age = Math.max(0, now - Date.parse(event.occurred_at));
      const index = Math.min(6, Math.max(0, 6 - Math.floor(age / rangeMs * 7)));
      bins[index].views += 1;
      bins[index].sessions.add(event.visitor_session_id);
    });
    const maxCount = Math.max(1, ...bins.flatMap((bin) => [bin.views, bin.sessions.size]));
    const scaleMax = Math.max(4, Math.ceil(maxCount / 4) * 4);
    const makePath = (key) => bins.map((bin, index) => {
      const x = index * 120;
      const y = 190 - (bin[key] / scaleMax) * 180;
      return `${index ? "L" : "M"}${x} ${y.toFixed(1)}`;
    }).join(" ");
    const visitorPath = makePath("sessions");
    const viewsPath = makePath("views");
    document.querySelector(".line-visitors").setAttribute("d", visitorPath);
    document.querySelector(".line-views").setAttribute("d", viewsPath);
    document.querySelector(".area-path").setAttribute("d", `${visitorPath} L720 200 L0 200Z`);
    const visitorLastY = 190 - (bins[6].sessions.size / scaleMax) * 180;
    const point = document.querySelector(".chart-point");
    point.setAttribute("cy", visitorLastY.toFixed(1));
    const tickSpans = document.querySelectorAll(".y-axis span");
    tickSpans.forEach((span, index) => {
      span.textContent = new Intl.NumberFormat("pt-BR", { notation: scaleMax >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 })
        .format(Math.round(scaleMax * (4 - index) / 4));
    });
    const labels = document.getElementById("chart-labels");
    labels.replaceChildren();
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(now - rangeMs * (6 - index) / 6);
      const label = document.createElement("span");
      label.textContent = date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }).replace(".", "");
      labels.append(label);
    }
    document.querySelector(".chart-wrap").setAttribute("aria-label", `Gráfico de dados reais com visitantes e visualizações nos últimos ${days} dias`);
  };

  const renderSiteAnalytics = (site, events, visitors, notifyNewVisitors) => {
    const formatNumber = (number) => new Intl.NumberFormat("pt-BR").format(number);
    const pageViews = events.filter((event) => event.event_type === "page_view");
    const sessionCounts = new Map();
    pageViews.forEach((event) => sessionCounts.set(event.visitor_session_id, (sessionCounts.get(event.visitor_session_id) || 0) + 1));
    const exits = events.filter((event) => event.event_type === "page_exit" && event.page_duration_seconds != null);
    const averageDuration = exits.length
      ? Math.round(exits.reduce((sum, event) => sum + event.page_duration_seconds, 0) / exits.length)
      : null;
    const bounces = [...sessionCounts.values()].filter((count) => count === 1).length;
    const bounceRate = sessionCounts.size ? (bounces / sessionCounts.size) * 100 : null;

    document.getElementById("live-visitors").textContent = formatNumber(visitors.length);
    document.getElementById("nav-live-count").textContent = formatNumber(visitors.length);
    document.getElementById("metric-visitors").textContent = formatNumber(sessionCounts.size);
    document.getElementById("metric-views").textContent = formatNumber(pageViews.length);
    document.getElementById("metric-time").textContent = averageDuration == null
      ? "—"
      : `${Math.floor(averageDuration / 60)}m ${String(averageDuration % 60).padStart(2, "0")}s`;
    document.getElementById("metric-bounce").innerHTML = `${bounceRate == null ? "—" : bounceRate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}<span class="value-unit">${bounceRate == null ? "" : "%"}</span>`;

    const referrals = new Map();
    pageViews.forEach((event) => {
      const source = event.referrer_domain || "Acesso direto";
      referrals.set(source, (referrals.get(source) || 0) + 1);
    });
    document.getElementById("source-total").textContent = formatNumber(pageViews.length);
    const sourceRows = document.querySelector(".source-bars");
    sourceRows.replaceChildren();
    const sourceFallback = ["Busca orgânica", "Direto", "Redes sociais", "Referências"];
    const sourceIds = ["source-organic", "source-direct", "source-social", "source-referrals"];
    const sourceColors = ["bar-purple", "bar-blue", "bar-pink", "bar-green"];
    const sources = [...referrals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (let index = 0; index < 4; index += 1) {
      const [sourceName, count] = sources[index] || [sourceFallback[index], 0];
      const percentage = pageViews.length ? Math.round(count / pageViews.length * 100) : 0;
      const row = document.createElement("div");
      row.className = "source-row";
      const meta = document.createElement("div");
      meta.className = "source-meta";
      const name = document.createElement("span");
      name.textContent = sourceName;
      const summary = document.createElement("strong");
      const total = document.createElement("span");
      total.id = sourceIds[index];
      total.className = "source-count";
      total.textContent = formatNumber(count);
      const ratio = document.createElement("small");
      ratio.textContent = `${percentage}%`;
      summary.append(total, document.createTextNode(" "), ratio);
      meta.append(name, summary);
      const track = document.createElement("div");
      track.className = "progress-track";
      const bar = document.createElement("i");
      bar.className = sourceColors[index];
      bar.style.width = `${percentage}%`;
      track.append(bar);
      row.append(meta, track);
      sourceRows.append(row);
    }

    const pageGroups = new Map();
    pageViews.forEach((event) => {
      const group = pageGroups.get(event.page_path) || { views: 0, duration: 0, durationCount: 0 };
      group.views += 1;
      pageGroups.set(event.page_path, group);
    });
    exits.forEach((event) => {
      const group = pageGroups.get(event.page_path);
      if (group) {
        group.duration += event.page_duration_seconds;
        group.durationCount += 1;
      }
    });
    const pageList = document.querySelector(".page-list");
    pageList.replaceChildren();
    const popularPages = [...pageGroups.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 4);
    if (!popularPages.length) {
      const empty = document.createElement("p");
      empty.className = "empty-data-message";
      empty.textContent = "Ainda não há eventos para este site.";
      pageList.append(empty);
    }
    popularPages.forEach(([path, stats], index) => {
      const row = document.createElement("div");
      row.className = "page-row";
      const rank = document.createElement("span");
      rank.className = "page-rank";
      rank.textContent = String(index + 1).padStart(2, "0");
      const info = document.createElement("div");
      info.className = "page-info";
      const title = document.createElement("strong");
      title.textContent = path;
      const subtitle = document.createElement("small");
      subtitle.textContent = "Páginas visualizadas";
      info.append(title, subtitle);
      const values = document.createElement("div");
      values.className = "page-stats";
      const count = document.createElement("strong");
      count.textContent = formatNumber(stats.views);
      const duration = document.createElement("small");
      const average = stats.durationCount ? Math.round(stats.duration / stats.durationCount) : null;
      duration.textContent = average == null ? "—" : `${Math.floor(average / 60)}m ${String(average % 60).padStart(2, "0")}s`;
      values.append(count, duration);
      row.append(rank, info, values);
      pageList.append(row);
    });

    const currentVisitorIds = new Set(visitors.map((visitor) => visitor.visitor_session_id));
    if (notifyNewVisitors && lastPresenceSiteId === site.id && soundEnabled) {
      const newVisitors = visitors.filter((visitor) => !knownVisitorIds.has(visitor.visitor_session_id));
      if (newVisitors.length) {
        void playAlert();
        showToast(newVisitors.length === 1 ? "Novo visitante" : "Novos visitantes",
          `${newVisitors.length} novo(s) acesso(s) detectado(s) no site.`);
      }
    }
    knownVisitorIds = currentVisitorIds;
    lastPresenceSiteId = site.id;
    visitorRows.replaceChildren();
    if (!visitors.length) renderEmptyVisitors("Nenhum visitante ativo no momento.");
    visitors.forEach((visitor) => {
      const row = document.createElement("tr");
      const location = document.createElement("td");
      const flag = document.createElement("span");
      flag.className = "country-flag";
      flag.textContent = visitor.country_code === "BR" ? "🇧🇷" : visitor.country_code === "PT" ? "🇵🇹" : "🌐";
      const label = document.createElement("span");
      label.className = "visitor-location";
      const city = document.createElement("strong");
      city.textContent = visitor.city || "Localização indisponível";
      const country = document.createElement("small");
      country.textContent = visitor.country_code || "Não informado";
      label.append(city, country);
      location.append(flag, label);
      const page = document.createElement("td");
      const path = document.createElement("span");
      path.className = "page-path";
      path.textContent = visitor.page_path;
      page.append(path);
      const durationCell = document.createElement("td");
      const duration = document.createElement("span");
      duration.className = "duration";
      const dot = document.createElement("i");
      const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(visitor.started_at)) / 1000));
      duration.append(dot, document.createTextNode(` ${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`));
      durationCell.append(duration);
      const providerCell = document.createElement("td");
      const provider = document.createElement("span");
      provider.className = "provider";
      provider.textContent = visitor.provider || "—";
      providerCell.append(provider);
      row.append(location, page, durationCell, providerCell);
      visitorRows.append(row);
    });

    document.querySelector(".chart").classList.toggle("no-data", pageViews.length === 0);
    renderTrend(events, document.getElementById("date-range").value);
    const notice = document.querySelector(".demo-notice");
    notice.hidden = false;
    notice.querySelector("p").textContent = site.verified_at
      ? "Domínio verificado. Instale o snippet para iniciar a coleta de acessos reais."
      : "Site registrado, mas ainda não verificado. A ingestão só poderá ser ativada após confirmar o domínio.";
    notice.querySelector(".notice-link").hidden = !site.verified_at;
    notice.querySelector(".notice-link").textContent = "Ver snippet";
  };

  const loadSiteAnalytics = async (site, { notifyNewVisitors = false } = {}) => {
    if (!site || !authSession) return;
    const session = await getSession();
    if (!session) return;
    const periodMs = Number(document.getElementById("date-range").value) * 24 * 60 * 60 * 1000;
    const eventParams = new URLSearchParams({
      select: "event_type,visitor_session_id,page_path,occurred_at,page_duration_seconds,referrer_domain",
      site_id: `eq.${site.id}`,
      occurred_at: `gte.${new Date(Date.now() - periodMs).toISOString()}`,
      order: "occurred_at.desc",
      limit: "2000",
    });
    const presenceParams = new URLSearchParams({
      select: "visitor_session_id,page_path,started_at,expires_at,country_code,city,provider",
      site_id: `eq.${site.id}`,
      expires_at: `gt.${new Date().toISOString()}`,
      order: "last_seen_at.desc",
      limit: "100",
    });
    try {
      const [events, visitors] = await Promise.all([
        supabaseRequest(`/rest/v1/site_events?${eventParams}`, { accessToken: session.access_token }),
        supabaseRequest(`/rest/v1/live_visitors?${presenceParams}`, { accessToken: session.access_token }),
      ]);
      if (activeSiteId === site.id) renderSiteAnalytics(site, events, visitors, notifyNewVisitors);
    } catch (error) {
      showToast("Não foi possível carregar as métricas", error.message, true);
    }
  };

  const loadSites = async () => {
    const session = await getSession();
    if (!session) {
      setAuthenticatedUi(null);
      userSites = [];
      activeSiteId = null;
      updateSitePicker();
      return;
    }
    const user = await supabaseRequest("/auth/v1/user", { accessToken: session.access_token });
    setAuthenticatedUi(user);
    userSites = await supabaseRequest("/rest/v1/sites?select=id,domain,verified_at,created_at&order=created_at.desc", {
      accessToken: session.access_token,
    });
    if (!userSites.some((site) => site.id === activeSiteId)) {
      activeSiteId = userSites[0]?.id || null;
    }
    updateSitePicker();
    if (activeSiteId) {
      await loadSiteAnalytics(userSites.find((site) => site.id === activeSiteId));
    }
  };

  const showAuthModal = (mode = "login") => {
    authMode = mode;
    authMessage.hidden = true;
    authMessage.textContent = "";
    document.getElementById("auth-title").textContent = mode === "signup" ? "Crie seu espaço" : "Entre no seu espaço";
    document.getElementById("auth-intro").textContent = mode === "signup"
      ? "Crie uma conta para registrar seus sites. Usamos autenticação segura do Supabase."
      : "Acesse seus sites e métricas privadas. A autenticação é gerenciada pelo Supabase.";
    document.getElementById("auth-submit").textContent = mode === "signup" ? "Criar conta" : "Entrar";
    document.getElementById("auth-switch-text").textContent = mode === "signup" ? "Já tem uma conta?" : "Ainda não tem uma conta?";
    document.getElementById("auth-switch").textContent = mode === "signup" ? "Entrar" : "Criar conta";
    authPassword.autocomplete = mode === "signup" ? "new-password" : "current-password";
    authModal.hidden = false;
    window.setTimeout(() => authEmail.focus(), 0);
  };

  const updateRange = (days) => {
    const metrics = {
      7: { visitors: "2.847", views: "6.391", time: "2m 34s", bounce: "38,6", sources: ["1.196", "797", "569", "285"], pages: ["1.284", "967", "742", "531"] },
      30: { visitors: "11.629", views: "28.214", time: "2m 41s", bounce: "36,2", sources: ["4.890", "3.280", "2.332", "1.127"], pages: ["5.200", "4.100", "3.420", "2.500"] },
      90: { visitors: "34.915", views: "83.502", time: "2m 29s", bounce: "39,1", sources: ["14.664", "9.776", "6.983", "3.492"], pages: ["15.500", "13.000", "11.200", "8.800"] },
    }[days];
    if (!metrics) return;
    document.getElementById("metric-visitors").textContent = metrics.visitors;
    document.getElementById("metric-views").textContent = metrics.views;
    document.getElementById("metric-time").textContent = metrics.time;
    document.getElementById("metric-bounce").innerHTML = `${metrics.bounce}<span class="value-unit">%</span>`;
    document.getElementById("source-total").textContent = metrics.visitors;
    ["source-organic", "source-direct", "source-social", "source-referrals"].forEach((id, index) => {
      document.getElementById(id).textContent = metrics.sources[index];
    });
    metrics.pages.forEach((value, index) => {
      document.getElementById(`popular-page-${index + 1}`).textContent = value;
    });
    const labels = document.getElementById("chart-labels");
    labels.replaceChildren();
    const today = new Date();
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(today);
      const daysAgo = Math.round(index * (Number(days) - 1) / 6);
      date.setDate(today.getDate() - daysAgo);
      const label = document.createElement("span");
      label.textContent = date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }).replace(".", "");
      labels.append(label);
    }
    document.querySelector(".chart-wrap").setAttribute("aria-label", `Gráfico de exemplo com visitantes e visualizações nos últimos ${days} dias`);
  };

  const renderVisitors = () => {
    visitorRows.replaceChildren();
    demoVisitors.forEach((visitor) => {
      const row = document.createElement("tr");
      const location = document.createElement("td");
      const flag = document.createElement("span");
      flag.className = "country-flag";
      flag.textContent = visitor.flag;
      const locationLabel = document.createElement("span");
      locationLabel.className = "visitor-location";
      const city = document.createElement("strong");
      city.textContent = visitor.city;
      const country = document.createElement("small");
      country.textContent = visitor.country;
      locationLabel.append(city, country);
      location.append(flag, locationLabel);

      const page = document.createElement("td");
      const path = document.createElement("span");
      path.className = "page-path";
      path.textContent = visitor.page;
      page.append(path);

      const duration = document.createElement("td");
      const durationLabel = document.createElement("span");
      durationLabel.className = "duration";
      const dot = document.createElement("i");
      durationLabel.append(dot, document.createTextNode(` ${visitor.duration}`));
      duration.append(durationLabel);

      const provider = document.createElement("td");
      const providerLabel = document.createElement("span");
      providerLabel.className = "provider";
      providerLabel.textContent = visitor.provider;
      provider.append(providerLabel);
      row.append(location, page, duration, provider);
      visitorRows.append(row);
    });
  };

  const playAlert = async () => {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        showToast("Áudio indisponível", "Seu navegador não oferece suporte a alertas sonoros.", true);
        return false;
      }
      audioContext ||= new AudioContextClass();
      if (audioContext.state === "suspended") await audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(740, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(990, audioContext.currentTime + 0.13);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.32);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.34);
      return true;
    } catch {
      showToast("Não foi possível tocar o alerta", "Verifique se o navegador permite reprodução de áudio.", true);
      return false;
    }
  };

  const openModal = () => {
    const domainModal = document.getElementById("site-modal");
    if (authSession === null) {
      showAuthModal();
      return;
    }
    domainModal.hidden = false;
    showDomainStep();
    domainError.hidden = true;
    window.setTimeout(() => domainInput.focus(), 0);
  };
  const closeModal = () => {
    modal.hidden = true;
    document.getElementById("add-site-button").focus();
  };
  const showDomainStep = () => {
    domainStep.hidden = false;
    verificationStep.hidden = true;
    trackingStep.hidden = true;
    modalTitle.textContent = "Vamos conectar seu site";
    modalIntro.textContent = "Informe o domínio que você administra. Para proteger os dados, vamos confirmar que o site é seu antes de ativar o monitoramento.";
    modalProgress.setAttribute("aria-label", "Passo 1 de 3");
    modalProgress.children[0].classList.add("progress-active");
    modalProgress.children[1].classList.remove("progress-active");
    modalStepLabel.innerHTML = "PASSO 1 DE 3 <span>·</span> ADICIONAR SITE";
  };
  const showVerificationStep = (site, challenge) => {
    pendingDomain = site.domain;
    pendingSiteId = site.id;
    document.getElementById("dns-name").textContent = challenge.record_name;
    document.getElementById("dns-value").textContent = challenge.record_value;
    document.getElementById("verification-message").textContent = "";
    domainStep.hidden = true;
    trackingStep.hidden = true;
    verificationStep.hidden = false;
    modalTitle.textContent = "Confirme que o site é seu";
    modalIntro.textContent = `Adicione o registro TXT ao DNS de ${site.domain}.`;
    modalProgress.setAttribute("aria-label", "Passo 2 de 3");
    modalProgress.children[0].classList.remove("progress-active");
    modalProgress.children[1].classList.add("progress-active");
    modalProgress.children[2].classList.remove("progress-active");
    modalStepLabel.innerHTML = "PASSO 2 DE 3 <span>·</span> VERIFICAR DOMÍNIO";
  };
  const showTrackingStep = (site) => {
    domainStep.hidden = true;
    verificationStep.hidden = true;
    trackingStep.hidden = false;
    modalTitle.textContent = "Instale o snippet de monitoramento";
    modalIntro.textContent = `Adicione o código abaixo ao HTML de ${site.domain}, antes da tag </body>.`;
    modalProgress.setAttribute("aria-label", "Passo 3 de 3");
    modalProgress.children[0].classList.remove("progress-active");
    modalProgress.children[1].classList.remove("progress-active");
    modalProgress.children[2].classList.add("progress-active");
    modalStepLabel.innerHTML = "PASSO 3 DE 3 <span>·</span> INSTALAR SNIPPET";
    const snippet = `<script async src="${window.location.origin}/vigia.js" data-site-id="${site.id}"></script>`;
    document.getElementById("tracking-snippet").textContent = snippet;
    document.getElementById("site-modal").hidden = false;
  };
  const issueVerificationChallenge = async (site) => {
    const session = await getSession();
    if (!session) throw new Error("Entre novamente para verificar este domínio.");
    const challenge = await supabaseRequest("/functions/v1/vigia-verification", {
      method: "POST",
      accessToken: session.access_token,
      body: { action: "issue", site_id: site.id },
    });
    showVerificationStep(site, challenge);
  };

  restoreTheme();
  renderVisitors();
  updateRange("7");
  try {
    const storedSession = sessionStorage.getItem("vigia-session");
    if (storedSession) authSession = JSON.parse(storedSession);
  } catch {
    authSession = null;
  }
  loadSites().catch((error) => {
    showToast("Não foi possível carregar sua conta", error.message, true);
  });

  themeToggle.addEventListener("click", () => {
    const dark = !body.classList.contains("dark");
    body.classList.toggle("dark", dark);
    themeToggle.setAttribute("aria-label", dark ? "Ativar tema claro" : "Ativar tema escuro");
    persist("vigia-theme", dark ? "dark" : "light");
  });

  try {
    soundEnabled = window.localStorage.getItem("vigia-alert-sound") === "on";
  } catch {
    soundEnabled = false;
  }
  const setSoundEnabled = (enabled) => {
    soundToggle.setAttribute("aria-pressed", String(enabled));
    soundStatus.textContent = enabled ? "Ativado" : "Desativado";
  };
  setSoundEnabled(soundEnabled);
  soundToggle.addEventListener("click", async () => {
    const enabling = !soundEnabled;
    if (enabling) {
      const played = await playAlert();
      if (!played) return;
    }
    soundEnabled = enabling;
    setSoundEnabled(soundEnabled);
    persist("vigia-alert-sound", soundEnabled ? "on" : "off");
    showToast(soundEnabled ? "Alerta sonoro ativado" : "Alerta sonoro desativado",
      soundEnabled ? "Prévia reproduzida. Os avisos de acesso exigem site verificado e snippet instalado." : "Nenhum som será reproduzido.");
  });

  document.getElementById("date-range").addEventListener("change", async (event) => {
    if (activeSiteId) {
      const site = userSites.find((item) => item.id === activeSiteId);
      if (site) await loadSiteAnalytics(site);
      return;
    }
    updateRange(event.target.value);
  });
  document.getElementById("add-site-button").addEventListener("click", openModal);
  document.getElementById("notice-add-site").addEventListener("click", () => {
    const activeSite = userSites.find((site) => site.id === activeSiteId);
    if (activeSite?.verified_at) showTrackingStep(activeSite);
    else openModal();
  });
  document.getElementById("site-switcher").addEventListener("click", () => {
    if (authSession && userSites.length) {
      siteMenu.hidden = !siteMenu.hidden;
    } else {
      openModal();
    }
  });
  document.getElementById("modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!authModal.hidden) authModal.hidden = true;
    else if (!modal.hidden) closeModal();
  });
  document.getElementById("dismiss-notice").addEventListener("click", () => {
    document.querySelector(".demo-notice").hidden = true;
  });

  document.getElementById("site-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const domain = domainInput.value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
    const validDomain = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
    if (!validDomain) {
      domainError.hidden = false;
      domainInput.setAttribute("aria-invalid", "true");
      domainInput.setAttribute("aria-describedby", "domain-hint domain-error");
      domainInput.focus();
      return;
    }
    domainError.hidden = true;
    domainInput.removeAttribute("aria-invalid");
    domainInput.setAttribute("aria-describedby", "domain-hint");
    if (!authSession) {
      pendingDomain = domain;
      modal.hidden = true;
      showAuthModal("login");
      showToast("Entre para registrar seu site", "Crie uma conta ou entre; o domínio informado será preservado.");
      return;
    }
    registerSite(domain);
  });
  domainInput.addEventListener("input", () => {
    domainError.hidden = true;
    domainInput.removeAttribute("aria-invalid");
    domainInput.setAttribute("aria-describedby", "domain-hint");
  });
  document.getElementById("back-to-domain").addEventListener("click", () => {
    domainInput.value = pendingDomain;
    showDomainStep();
    domainInput.focus();
  });
  document.getElementById("tracking-done").addEventListener("click", closeModal);
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = document.getElementById(button.dataset.copy).textContent;
      try {
        await navigator.clipboard.writeText(value);
        showToast("Copiado", "O conteúdo foi copiado.");
      } catch {
        showToast("Não foi possível copiar", "Selecione e copie o valor manualmente.", true);
      }
    });
  });
  document.getElementById("check-domain").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const session = await getSession();
    if (!session || !pendingSiteId) {
      showToast("Sessão expirada", "Entre novamente para verificar o domínio.", true);
      return;
    }
    const message = document.getElementById("verification-message");
    button.disabled = true;
    button.textContent = "Consultando DNS…";
    message.textContent = "";
    try {
      const result = await supabaseRequest("/functions/v1/vigia-verification", {
        method: "POST",
        accessToken: session.access_token,
        body: { action: "verify", site_id: pendingSiteId },
      });
      if (!result.verified) {
        message.textContent = result.message || "O registro TXT ainda não foi encontrado.";
        return;
      }
      const site = userSites.find((item) => item.id === pendingSiteId);
      if (!site) throw new Error("Site não encontrado na conta atual.");
      site.verified_at = result.verified_at;
      updateSitePicker();
      await loadSiteAnalytics(site);
      showTrackingStep(site);
      showToast("Domínio verificado", "O site foi autorizado. Instale o snippet para iniciar a coleta.");
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Verificar domínio";
    }
  });

  const registerSite = async (domain) => {
    const session = await getSession();
    if (!session) {
      pendingDomain = domain;
      document.getElementById("site-modal").hidden = true;
      showAuthModal();
      return;
    }
    try {
      const user = await supabaseRequest("/auth/v1/user", { accessToken: session.access_token });
      let site;
      try {
        const created = await supabaseRequest("/rest/v1/sites", {
          method: "POST",
          accessToken: session.access_token,
          headers: { Prefer: "return=representation" },
          body: { owner_id: user.id, domain },
        });
        site = created[0];
        userSites = [site, ...userSites];
      } catch (error) {
        if (error.code !== "23505") throw error;
        await loadSites();
        site = userSites.find((item) => item.domain === domain);
        if (!site) throw error;
      }
      activeSiteId = site.id;
      updateSitePicker();
      if (site.verified_at) {
        await loadSiteAnalytics(site);
        showTrackingStep(site);
        return;
      }
      await issueVerificationChallenge(site);
      showToast("Registro DNS gerado", `Adicione o TXT indicado para ${domain} e depois confirme a verificação.`);
    } catch (error) {
      showToast("Não foi possível preparar a verificação", error.message, true);
    }
  };

  authButton.addEventListener("click", async () => {
    if (!authSession) {
      showAuthModal();
      return;
    }
    try {
      await supabaseRequest("/auth/v1/logout", { method: "POST", accessToken: authSession.access_token });
    } catch (error) {
      showToast("Não foi possível encerrar a sessão", error.message, true);
    } finally {
      clearSession();
      userSites = [];
      activeSiteId = null;
      lastPresenceSiteId = null;
      knownVisitorIds = new Set();
      siteMenu.hidden = true;
      setAuthenticatedUi(null);
      updateSitePicker();
      renderVisitors();
      updateRange(document.getElementById("date-range").value);
      document.querySelector(".chart").classList.remove("no-data");
      document.querySelector(".demo-notice").hidden = false;
      document.querySelector(".demo-notice p").innerHTML = "<strong>Você está vendo dados de demonstração.</strong> Nenhuma visita real está sendo coletada. Conecte seu site para ativar métricas reais.";
      document.querySelector(".notice-link").hidden = false;
      showToast("Sessão encerrada", "Sua conta foi desconectada deste navegador.");
    }
  });
  document.querySelector(".profile-button").addEventListener("click", () => {
    if (!authSession) showAuthModal();
  });
  document.getElementById("auth-close").addEventListener("click", () => { authModal.hidden = true; });
  authModal.addEventListener("click", (event) => { if (event.target === authModal) authModal.hidden = true; });
  document.getElementById("auth-switch").addEventListener("click", () => showAuthModal(authMode === "login" ? "signup" : "login"));
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authMessage.hidden = true;
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      authMessage.textContent = "Informe um e-mail válido e uma senha com pelo menos 8 caracteres.";
      authMessage.hidden = false;
      return;
    }
    const submit = document.getElementById("auth-submit");
    submit.disabled = true;
    submit.textContent = authMode === "signup" ? "Criando conta…" : "Entrando…";
    try {
      const response = authMode === "signup"
        ? await supabaseRequest("/auth/v1/signup", { method: "POST", body: { email, password } })
        : await supabaseRequest("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
      if (!response.access_token) {
        authMessage.textContent = "Conta iniciada. Confira seu e-mail para confirmar a conta e depois entre.";
        authMessage.hidden = false;
        return;
      }
      saveSession({ ...response, expires_at: Date.now() / 1000 + (response.expires_in || 3600) });
      authModal.hidden = true;
      authPassword.value = "";
      await loadSites();
      showToast("Bem-vindo ao Vigia", "Sua conta foi conectada ao projeto Supabase.");
      if (pendingDomain) await registerSite(pendingDomain);
    } catch (error) {
      authMessage.textContent = error.message;
      authMessage.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = authMode === "signup" ? "Criar conta" : "Entrar";
    }
  });

  document.getElementById("refresh-visitors").addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.classList.add("is-refreshing");
    window.setTimeout(() => button.classList.remove("is-refreshing"), 750);
    const site = userSites.find((item) => item.id === activeSiteId);
    if (site) {
      void loadSiteAnalytics(site, { notifyNewVisitors: true });
    } else {
      showToast("Dados de demonstração", "A lista não se conecta a visitantes reais neste protótipo.", true);
    }
  });
  document.getElementById("show-sources").addEventListener("click", () => showToast("Origens de tráfego", "Os canais exibidos são exemplos e não vêm de uma fonte de analytics."));
  document.getElementById("show-pages").addEventListener("click", () => showToast("Páginas populares", "As páginas e tempos exibidos são dados de demonstração."));

  window.setInterval(() => {
    if (!authSession || !activeSiteId) return;
    const activeSite = userSites.find((site) => site.id === activeSiteId);
    if (activeSite) void loadSiteAnalytics(activeSite, { notifyNewVisitors: true });
  }, 15_000);

  const installButton = document.getElementById("install-app");
  let installPrompt = null;
  const isInstalledApp = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
  if (!isInstalledApp) {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPrompt = event;
      installButton.hidden = false;
    });
  }
  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
  });

  const isSecureInstallContext = window.location.protocol === "https:"
    || ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if ("serviceWorker" in navigator && isSecureInstallContext) {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      showToast("Não foi possível preparar a instalação", error.message, true);
    });
  }
})();
