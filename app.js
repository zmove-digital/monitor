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
  let alertTone = "classico";
  const DEMO_CITIES = [
    { city: "Campinas", country: "BR", visitors: 614 },
    { city: "Valinhos", country: "BR", visitors: 187 },
    { city: "Vinhedo", country: "BR", visitors: 121 },
    { city: "São Paulo", country: "BR", visitors: 106 },
    { city: "Sumaré", country: "BR", visitors: 88 },
    { city: "Jundiaí", country: "BR", visitors: 71 },
    { city: "Limeira", country: "BR", visitors: 55 },
  ];
  let sourceBreakdown = [];
  let recoverySession = null;

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

  // No APK (Capacitor) a sessão precisa sobreviver a fechar e reabrir o app;
  // no navegador, mantenho o escopo da aba (sessionStorage) por privacidade.
  const getAuthStorage = () => {
    const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
    return isNative ? window.localStorage : window.sessionStorage;
  };

  const clearSession = () => {
    authSession = null;
    try {
      getAuthStorage().removeItem("vigia-session");
      window.sessionStorage.removeItem("vigia-session");
      window.localStorage.removeItem("vigia-session");
    } catch {
      // Storage optional; the signed-out state is cleared in memory.
    }
  };

  const saveSession = (session) => {
    authSession = session;
    try {
      getAuthStorage().setItem("vigia-session", JSON.stringify(session));
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
    const breadcrumbSite = document.getElementById("breadcrumb-site");
    const topbarSite = document.getElementById("topbar-site");
    if (!activeSite) {
      name.textContent = userSites.length ? "Selecione um site" : "Adicione seu site";
      domain.textContent = userSites.length ? `${userSites.length} site(s) na conta` : "Nenhum site conectado";
      breadcrumbSite.textContent = userSites.length ? "Selecione um site" : "Visão geral";
      topbarSite.hidden = true;
      // Demo warning belongs only to the state without a monitored site.
      document.querySelector(".demo-notice").hidden = userSites.length > 0;
      renderSiteMenu();
      return;
    }
    name.textContent = activeSite.verified_at ? activeSite.domain : `${activeSite.domain} · não verificado`;
    domain.textContent = "Conta Vigia";
    breadcrumbSite.textContent = activeSite.domain.toLowerCase();
    topbarSite.hidden = false;
    topbarSite.textContent = activeSite.domain.toLowerCase();
    topbarSite.title = activeSite.verified_at
      ? `${activeSite.domain} — em monitoramento`
      : `${activeSite.domain} — aguardando verificação`;
    renderSiteMenu();
  };

  const renderEmptyVisitors = (message) => {
    visitorRows.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
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
    // bin.sessions is a Set; the series value must be its size, never the object itself.
    const visitorValues = bins.map((bin) => bin.sessions.size);
    const viewValues = bins.map((bin) => bin.views);
    const makePath = (values) => values.map((value, index) => {
      const x = index * 120;
      const y = 190 - (value / scaleMax) * 180;
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

  const numberFormatter = new Intl.NumberFormat("pt-BR");
  const formatNumber = (number) => numberFormatter.format(number);

  const TRAFFIC_CHANNELS = [
    { name: "Google (busca)", color: "bar-purple", always: true },
    { name: "Google Ads", color: "bar-orange", always: false },
    { name: "Acesso direto", color: "bar-blue", always: true },
    { name: "Redes sociais", color: "bar-pink", always: false },
    { name: "Outras buscas", color: "bar-green", always: false },
    { name: "Outros sites", color: "bar-slate", always: false },
  ];
  const GOOGLE_SEARCH_HOST = /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,4}(?:\.[a-z]{2})?$/;
  const GOOGLE_APP_HOSTS = ["com.google.android.googlequicksearchbox"];
  const SOCIAL_DOMAINS = [
    "facebook.com", "fb.com", "instagram.com", "t.co", "twitter.com", "x.com",
    "linkedin.com", "lnkd.in", "youtube.com", "youtu.be", "tiktok.com", "pinterest.com",
    "reddit.com", "whatsapp.com", "wa.me", "telegram.org", "t.me", "threads.net",
    "snapchat.com", "discord.com", "twitch.tv", "tumblr.com", "vk.com", "kwai.com",
  ];
  const OTHER_SEARCH_DOMAINS = [
    "bing.com", "duckduckgo.com", "search.brave.com", "ecosia.org", "qwant.com",
    "startpage.com", "search.yahoo.com", "yahoo.com", "msn.com", "yandex.com",
    "yandex.ru", "baidu.com", "naver.com", "seznam.cz",
  ];

  const hostMatches = (host, domains) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

  // "Acesso direto" means the browser sent neither a referrer nor a Google campaign
  // signal. A visit that truly came from Google but had its referrer stripped (apps,
  // private mode, no-referrer policy) cannot be told apart and stays as direct traffic.
  const classifyTrafficSource = (domain) => {
    if (!domain) return "Acesso direto";
    const host = String(domain).trim().toLowerCase();
    if (host === "ads.google.com") return "Google Ads";
    if (host === "google.com" || GOOGLE_SEARCH_HOST.test(host) || hostMatches(host, GOOGLE_APP_HOSTS)) return "Google (busca)";
    if (hostMatches(host, SOCIAL_DOMAINS)) return "Redes sociais";
    if (hostMatches(host, OTHER_SEARCH_DOMAINS)) return "Outras buscas";
    return "Outros sites";
  };

  const renderSourceRows = (entries, total) => {
    const sourceRows = document.querySelector(".source-bars");
    sourceRows.replaceChildren();
    entries.forEach(([name, count, color]) => {
      const percentage = total ? Math.round((count / total) * 100) : 0;
      const row = document.createElement("div");
      row.className = "source-row";
      const meta = document.createElement("div");
      meta.className = "source-meta";
      const label = document.createElement("span");
      label.textContent = name;
      const summary = document.createElement("strong");
      const value = document.createElement("span");
      value.className = "source-count";
      value.textContent = formatNumber(count);
      const ratio = document.createElement("small");
      ratio.textContent = `${percentage}%`;
      summary.append(value, document.createTextNode(" "), ratio);
      meta.append(label, summary);
      const track = document.createElement("div");
      track.className = "progress-track";
      const bar = document.createElement("i");
      bar.className = color;
      bar.style.width = `${percentage}%`;
      track.append(bar);
      row.append(meta, track);
      sourceRows.append(row);
    });
  };

  const cityList = document.getElementById("cities-list");
  const cityTotal = document.getElementById("cities-total");
  const topCityList = document.getElementById("top-cities-list");

  const flagForCountry = (country) => country === "BR" ? "🇧🇷" : country === "PT" ? "🇵🇹" : "🌐";

  // Counts unique visitor sessions per city across the selected period.
  const aggregateCityRanking = (events) => {
    const cityStats = new Map();
    events.forEach((event) => {
      if (!event.city) return;
      const entry = cityStats.get(event.city) || { country: null, sessions: new Set() };
      entry.sessions.add(event.visitor_session_id);
      if (!entry.country && event.country_code) entry.country = event.country_code;
      cityStats.set(event.city, entry);
    });
    return [...cityStats.entries()]
      .map(([city, entry]) => ({ city, country: entry.country, visitors: entry.sessions.size }))
      .sort((a, b) => b.visitors - a.visitors || a.city.localeCompare(b.city, "pt-BR"));
  };

  const renderCityRows = (container, ranking, { limit = Number.MAX_SAFE_INTEGER, withBars = false } = {}) => {
    container.replaceChildren();
    const slice = ranking.slice(0, limit);
    if (!slice.length) {
      const empty = document.createElement("p");
      empty.className = "empty-data-message";
      empty.textContent = "Por enquanto, nenhuma cidade foi identificada para o site neste período.";
      container.append(empty);
      return;
    }
    const top = slice[0].visitors || 1;
    slice.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "city-row";
      const rank = document.createElement("span");
      rank.className = "city-rank";
      rank.textContent = String(index + 1).padStart(2, "0");
      const info = document.createElement("div");
      info.className = "city-info";
      const name = document.createElement("strong");
      name.textContent = item.city;
      const detail = document.createElement("small");
      detail.textContent = item.country ? `${flagForCountry(item.country)} ${item.country}` : "País não identificado";
      info.append(name, detail);
      const stats = document.createElement("div");
      stats.className = "city-stats";
      const count = document.createElement("strong");
      count.textContent = formatNumber(item.visitors);
      const share = document.createElement("small");
      share.textContent = `${Math.round((item.visitors / top) * 100)}%`;
      stats.append(count, share);
      if (withBars) {
        const track = document.createElement("div");
        track.className = "progress-track";
        const bar = document.createElement("i");
        bar.className = "bar-purple";
        bar.style.width = `${Math.max(6, Math.round((item.visitors / top) * 100))}%`;
        track.append(bar);
        stats.append(track);
      }
      row.append(rank, info, stats);
      container.append(row);
    });
  };

  const updateCityPanels = (ranking) => {
    renderCityRows(cityList, ranking);
    cityTotal.textContent = formatNumber(ranking.length);
    renderCityRows(topCityList, ranking, { limit: 5, withBars: true });
  };

  const renderSiteAnalytics = (site, events, visitors, notifyNewVisitors) => {
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

    // Attribute each visitor to the source of the first page view in the session, so a
    // visit that started on Google is not counted as direct when the visitor navigates.
    const sessionSources = new Map();
    [...pageViews].reverse().forEach((event) => {
      if (!sessionSources.has(event.visitor_session_id)) {
        sessionSources.set(event.visitor_session_id, event.referrer_domain || null);
      }
    });
    const channelCounts = new Map();
    const domainCounts = new Map();
    sessionSources.forEach((domain) => {
      const channel = classifyTrafficSource(domain);
      channelCounts.set(channel, (channelCounts.get(channel) || 0) + 1);
      const label = domain || "Acesso direto";
      domainCounts.set(label, (domainCounts.get(label) || 0) + 1);
    });
    const visitorTotal = sessionSources.size;
    document.getElementById("source-total").textContent = formatNumber(visitorTotal);
    renderSourceRows(
      TRAFFIC_CHANNELS
        .filter((channel) => channel.always || (channelCounts.get(channel.name) || 0) > 0)
        .map((channel) => [channel.name, channelCounts.get(channel.name) || 0, channel.color]),
      visitorTotal,
    );
    sourceBreakdown = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);

    updateCityPanels(aggregateCityRanking(pageViews));

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
      row.append(location, page, durationCell);
      visitorRows.append(row);
    });

    document.querySelector(".chart").classList.toggle("no-data", pageViews.length === 0);
    renderTrend(events, document.getElementById("date-range").value);
    // Real data is on screen whenever a site is connected; the demo warning is
    // only meant for the signed-out / no-site state.
    document.querySelector(".demo-notice").hidden = true;
    markUpdatedAt();
  };

  const loadSiteAnalytics = async (site, { notifyNewVisitors = false } = {}) => {
    if (!site || !authSession) return;
    const session = await getSession();
    if (!session) return;
    const periodMs = Number(document.getElementById("date-range").value) * 24 * 60 * 60 * 1000;
    const eventParams = new URLSearchParams({
      select: "event_type,visitor_session_id,page_path,occurred_at,page_duration_seconds,referrer_domain,city,country_code",
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
    const recovery = mode === "recovery";
    authMessage.hidden = true;
    authMessage.textContent = "";
    authMessage.classList.add("field-error");
    authMessage.classList.remove("field-success");
    authModal.hidden = false;
    document.getElementById("auth-title").textContent = recovery
      ? "Defina uma nova senha"
      : mode === "signup" ? "Crie seu espaço" : "Entre no seu espaço";
    document.getElementById("auth-intro").textContent = recovery
      ? "Você abriu um link de recuperação. Escolha a nova senha da sua conta."
      : mode === "signup"
        ? "Crie uma conta para registrar seus sites. Usamos autenticação segura do Supabase."
        : "Acesse seus sites e métricas privadas. A autenticação é gerenciada pelo Supabase.";
    document.getElementById("auth-submit").textContent = recovery ? "Salvar nova senha" : mode === "signup" ? "Criar conta" : "Entrar";
    document.getElementById("auth-email-label").hidden = recovery;
    document.getElementById("auth-email-field").hidden = recovery;
    document.getElementById("auth-forgot").hidden = recovery || mode === "signup";
    authPassword.value = "";
    authPassword.autocomplete = mode === "login" ? "current-password" : "new-password";
    authPassword.placeholder = recovery ? "Nova senha (mín. 8 caracteres)" : "Mínimo de 8 caracteres";
    document.getElementById("auth-switch-text").textContent = recovery
      ? "Lembrou a senha?"
      : mode === "signup" ? "Já tem uma conta?" : "Ainda não tem uma conta?";
    document.getElementById("auth-switch").textContent = recovery
      ? "Voltar para o login"
      : mode === "signup" ? "Entrar" : "Criar conta";
    window.setTimeout(() => (recovery ? authPassword : authEmail).focus(), 0);
  };

  const getRecoveryRedirect = () => {
    const { protocol, hostname, origin, pathname } = window.location;
    if (protocol !== "https:" || hostname === "localhost" || hostname === "127.0.0.1") return "";
    return `${origin}${pathname}`;
  };

  // Supabase sends the recovery link with the session tokens in the URL hash.
  const handleRecoveryLink = () => {
    const rawHash = window.location.hash.replace(/^#/, "");
    if (!rawHash) return false;
    const params = new URLSearchParams(rawHash);
    const error = params.get("error_description") || params.get("error");
    if (!error && params.get("type") !== "recovery") return false;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (error) {
      showAuthModal("login");
      authMessage.textContent = "O link de recuperação expirou ou já foi usado. Use “Esqueci minha senha” para receber outro.";
      authMessage.hidden = false;
      return true;
    }
    if (!params.get("access_token")) return false;
    recoverySession = {
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token"),
      expires_in: Number(params.get("expires_in")) || 3600,
      token_type: params.get("token_type") || "bearer",
    };
    showAuthModal("recovery");
    return true;
  };

  const updateRange = (days) => {
    const metrics = {
      7: { visitors: 2847, views: 6391, time: "2m 34s", bounce: "38,6", sources: [1196, 797, 569, 285], pages: ["1.284", "967", "742", "531"] },
      30: { visitors: 11629, views: 28214, time: "2m 41s", bounce: "36,2", sources: [4890, 3280, 2332, 1127], pages: ["5.200", "4.100", "3.420", "2.500"] },
      90: { visitors: 34915, views: 83502, time: "2m 29s", bounce: "39,1", sources: [14664, 9776, 6983, 3492], pages: ["15.500", "13.000", "11.200", "8.800"] },
    }[days];
    if (!metrics) return;
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    setText("metric-visitors", formatNumber(metrics.visitors));
    setText("metric-views", formatNumber(metrics.views));
    setText("metric-time", metrics.time);
    const bounce = document.getElementById("metric-bounce");
    if (bounce) bounce.innerHTML = `${metrics.bounce}<span class="value-unit">%</span>`;
    setText("source-total", formatNumber(metrics.visitors));
    updateCityPanels(DEMO_CITIES);
    renderSourceRows([
      ["Google (busca)", metrics.sources[0], "bar-purple"],
      ["Acesso direto", metrics.sources[1], "bar-blue"],
      ["Redes sociais", metrics.sources[2], "bar-pink"],
      ["Outros sites", metrics.sources[3], "bar-green"],
    ], metrics.visitors);
    sourceBreakdown = [];
    metrics.pages.forEach((value, index) => setText(`popular-page-${index + 1}`, value));
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
      row.append(location, page, duration);
      visitorRows.append(row);
    });
  };

  const ALERT_TONES = {
    classico: ["sine", 740, 990],
    suave: ["sine", 520, 660],
    urgente: ["square", 620, 930],
    sino: ["triangle", 880, 1320],
  };
  const markUpdatedAt = () => {
    const updated = document.getElementById("updated-at");
    if (!updated) return;
    const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    updated.textContent = `Atualizado às ${time}`;
  };

  const playAlert = async () => {
    const tone = ALERT_TONES[alertTone] || ALERT_TONES.classico;
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
      oscillator.type = tone[0];
      oscillator.frequency.setValueAtTime(tone[1], audioContext.currentTime);
      oscillator.frequency.setValueAtTime(tone[2], audioContext.currentTime + (tone[0] === "square" ? 0.09 : 0.13));
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(tone[0] === "square" ? 0.07 : 0.12, audioContext.currentTime + 0.025);
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
    const trackerOrigin = supabase?.trackerUrl || window.location.origin;
    const snippet = `<script async src="${trackerOrigin}/vigia.js" data-site-id="${site.id}"></script>`;
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
  updateCityPanels(DEMO_CITIES);
  markUpdatedAt();
  try {
    const storedSession = getAuthStorage().getItem("vigia-session");
    if (storedSession) authSession = JSON.parse(storedSession);
  } catch {
    authSession = null;
  }
  const recoveryMode = handleRecoveryLink();
  if (recoveryMode) authSession = null;
  if (!recoveryMode) {
    loadSites().catch((error) => {
      showToast("Não foi possível carregar sua conta", error.message, true);
    });
  }

  themeToggle.addEventListener("click", () => {
    const dark = !body.classList.contains("dark");
    body.classList.toggle("dark", dark);
    themeToggle.setAttribute("aria-label", dark ? "Ativar tema claro" : "Ativar tema escuro");
    persist("vigia-theme", dark ? "dark" : "light");
  });

  try {
    soundEnabled = window.localStorage.getItem("vigia-alert-sound") === "on";
    alertTone = window.localStorage.getItem("vigia-alert-tone") || "classico";
  } catch {
    soundEnabled = false;
    alertTone = "classico";
  }
  const soundToneSelect = document.getElementById("sound-tone");
  if (!ALERT_TONES[alertTone]) alertTone = "classico";
  soundToneSelect.value = alertTone;
  soundToneSelect.addEventListener("change", () => {
    alertTone = soundToneSelect.value;
    persist("vigia-alert-tone", alertTone);
    void playAlert();
    showToast("Toque atualizado", `Prévia do toque “${soundToneSelect.options[soundToneSelect.selectedIndex].text}”.`);
  });
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

  // Push notifications (APK): avisam sobre novas visitas com o aplicativo fechado.
  const pushToggle = document.getElementById("push-toggle");
  const pushStatus = document.getElementById("push-status");
  const pushPlugin = window.Capacitor?.isNativePlatform?.() ? window.Capacitor?.Plugins?.PushNotifications : null;
  let pushEnabled = true;
  let pushRegisteredToken = null;
  let pushListenersBound = false;

  try {
    pushEnabled = window.localStorage.getItem("vigia-push") !== "off";
  } catch {
    pushEnabled = true;
  }

  if (!pushPlugin) pushToggle.hidden = true;

  const setPushUi = (enabled) => {
    pushToggle.setAttribute("aria-pressed", String(enabled));
    pushStatus.textContent = enabled ? "Ativada" : "Desativada";
  };

  const registerPushTokenWithServer = async (token) => {
    const session = await getSession();
    if (!session) throw new Error("Entre com sua conta para ativar as notificações.");
    await supabaseRequest("/functions/v1/vigia-push", {
      method: "POST",
      body: { action: "register", token },
      accessToken: session.access_token,
    });
    pushRegisteredToken = token;
    setPushUi(true);
    showToast("Notificações ativadas", "Você será avisado de novas visitas com o app fechado.");
  };

  const setupPushNotifications = async () => {
    if (!pushPlugin || !authSession) return;
    try {
      const permission = await pushPlugin.requestPermissions();
      if (permission.receive !== "granted") {
        setPushUi(false);
        showToast("Permissão ausente", "Autorize as notificações do Vigia nas configurações do Android.", true);
        return;
      }
      if (!pushListenersBound) {
        pushListenersBound = true;
        pushPlugin.addListener("registration", ({ value }) => {
          void registerPushTokenWithServer(value).catch((error) => {
            showToast("Notificação indisponível", error.message, true);
          });
        });
        pushPlugin.addListener("registrationError", () => {
          setPushUi(false);
        });
        pushPlugin.addListener("pushNotificationReceived", () => {
          const site = userSites.find((item) => item.id === activeSiteId);
          if (site) void loadSiteAnalytics(site, { notifyNewVisitors: true });
        });
      }
      await pushPlugin.register();
    } catch (error) {
      setPushUi(false);
      showToast("Notificação indisponível", error.message, true);
    }
  };

  setPushUi(pushEnabled);
  if (authSession && pushEnabled) void setupPushNotifications();

  pushToggle.addEventListener("click", async () => {
    const session = await getSession();
    if (!session) {
      showAuthModal();
      return;
    }
    const enabling = !pushEnabled;
    pushEnabled = enabling;
    persist("vigia-push", enabling ? "on" : "off");
    setPushUi(enabling);
    if (enabling) {
      if (pushRegisteredToken) {
        try {
          await registerPushTokenWithServer(pushRegisteredToken);
        } catch (error) {
          showToast("Notificação indisponível", error.message, true);
        }
      } else if (pushPlugin) {
        await setupPushNotifications();
      }
      return;
    }
    try {
      await supabaseRequest("/functions/v1/vigia-push", {
        method: "POST",
        body: { action: "unregister", ...(pushRegisteredToken ? { token: pushRegisteredToken } : {}) },
        accessToken: session.access_token,
      });
    } catch (error) {
      showToast("Não foi possível desativar no servidor", error.message, true);
    }
    showToast("Notificações desativadas", "Sem avisos de novas visitas com o app fechado.");
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
      try {
        await supabaseRequest("/functions/v1/vigia-push", {
          method: "POST",
          body: { action: "unregister" },
          accessToken: authSession.access_token,
        });
      } catch {
        // Best-effort: sign-out proceeds even if the token cleanup fails.
      }
      pushRegisteredToken = null;
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
  document.getElementById("auth-forgot").addEventListener("click", async () => {
    const email = authEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      authMessage.classList.add("field-error");
      authMessage.classList.remove("field-success");
      authMessage.textContent = "Digite seu e-mail acima para receber o link de recuperação.";
      authMessage.hidden = false;
      authEmail.focus();
      return;
    }
    const button = document.getElementById("auth-forgot");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Enviando…";
    authMessage.hidden = true;
    try {
      const redirect = getRecoveryRedirect();
      const query = redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : "";
      await supabaseRequest(`/auth/v1/recover${query}`, { method: "POST", body: { email } });
      authMessage.classList.remove("field-error");
      authMessage.classList.add("field-success");
      authMessage.textContent = "Se existir uma conta com esse e-mail, enviamos um link para definir uma nova senha. Confira também a caixa de spam.";
      authMessage.hidden = false;
    } catch (error) {
      authMessage.classList.add("field-error");
      authMessage.classList.remove("field-success");
      authMessage.textContent = /rate limit|too many/i.test(error.message)
        ? "Muitos pedidos em pouco tempo. Aguarde alguns minutos antes de tentar novamente."
        : error.message;
      authMessage.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authMessage.hidden = true;
    authMessage.classList.add("field-error");
    authMessage.classList.remove("field-success");
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (authMode === "recovery") {
      if (!recoverySession?.access_token) {
        authMessage.textContent = "O link de recuperação expirou. Use “Esqueci minha senha” para receber outro.";
        authMessage.hidden = false;
        return;
      }
      if (password.length < 8) {
        authMessage.textContent = "A nova senha precisa ter pelo menos 8 caracteres.";
        authMessage.hidden = false;
        return;
      }
      const submit = document.getElementById("auth-submit");
      submit.disabled = true;
      submit.textContent = "Salvando…";
      try {
        await supabaseRequest("/auth/v1/user", {
          method: "PUT",
          accessToken: recoverySession.access_token,
          body: { password },
        });
        saveSession({ ...recoverySession, expires_at: Date.now() / 1000 + (recoverySession.expires_in || 3600) });
        recoverySession = null;
        authModal.hidden = true;
        authPassword.value = "";
        await loadSites();
        showToast("Senha atualizada", "Sua nova senha foi salva e você já está conectado.");
      } catch (error) {
        authMessage.textContent = /jwt|token|expired/i.test(error.message)
          ? "O link de recuperação expirou ou já foi usado. Use “Esqueci minha senha” para receber outro."
          : error.message;
        authMessage.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = "Salvar nova senha";
      }
      return;
    }
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
      void setupPushNotifications();
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
      markUpdatedAt();
      showToast("Dados atualizados", "Modo demonstração em exibição; entre com um site para recarregar métricas reais.", true);
    }
  });

  document.getElementById("refresh-data").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.classList.add("is-refreshing");
    try {
      await Promise.resolve();
      const site = userSites.find((item) => item.id === activeSiteId);
      if (site) {
        await loadSiteAnalytics(site, { notifyNewVisitors: true });
        showToast("Painel atualizado", "Métricas recarregadas agora.");
      } else {
        markUpdatedAt();
        showToast("Painel atualizado", "Modo demonstração em exibição; não há site conectado.", true);
      }
    } finally {
      button.disabled = false;
      button.classList.remove("is-refreshing");
    }
  });
  document.getElementById("show-sources").addEventListener("click", () => {
    if (!sourceBreakdown.length) {
      showToast("Origens de tráfego", "Os canais exibidos são exemplos e não vêm de uma fonte de analytics.");
      return;
    }
    const summary = sourceBreakdown
      .slice(0, 6)
      .map(([name, count]) => `${name}: ${formatNumber(count)}`)
      .join(" · ");
    showToast("Origens de tráfego", `${summary}. O Google só é separado quando o navegador envia o referrer do Google ou parâmetros de campanha (gclid, utm_source); sem esses sinais, a visita fica em Acesso direto.`);
  });
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
