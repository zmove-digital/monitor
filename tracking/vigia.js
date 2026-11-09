(() => {
  "use strict";

  const script = document.currentScript;
  const siteId = script?.dataset.siteId;
  if (!siteId || !/^[0-9a-f-]{36}$/i.test(siteId)) return;

  const endpoint = "https://cmclojrcwjrfezoaidzw.supabase.co/functions/v1/vigia-ingest";
  const publishableKey = "sb_publishable_8rzmwGtqZz0PSo21n-h33Q_HZsfzOt5";
  const storageKey = `vigia-session:${siteId}`;
  const sourceKey = `vigia-source:${siteId}`;

  const GOOGLE_ADS_PARAMS = ["gclid", "gbraid", "wbraid", "dclid", "gad_source"];
  const GOOGLE_CAMPAIGN_SOURCE = /^google(?:[._-]ads)?(?:\.com)?$/;
  const GOOGLE_APP_REFERRERS = new Set(["com.google.android.googlequicksearchbox"]);
  const VALID_HOST = /^[a-z0-9.-]{1,253}$/i;

  let visitorSessionId;
  try {
    visitorSessionId = sessionStorage.getItem(storageKey);
    if (!visitorSessionId) {
      visitorSessionId = crypto.randomUUID();
      sessionStorage.setItem(storageKey, visitorSessionId);
    }
  } catch (error) {
    console.warn("Vigia could not create a temporary visitor session.", error);
    return;
  }

  const pageStartedAt = Date.now();
  const getPagePath = () => window.location.pathname.slice(0, 2048) || "/";

  const getReferrerDomain = () => {
    if (!document.referrer) return null;
    try {
      const host = new URL(document.referrer).hostname.toLowerCase();
      if (!host || host === window.location.hostname.toLowerCase()) return null;
      return VALID_HOST.test(host) ? host : null;
    } catch {
      return null;
    }
  };

  // Google only reveals itself through the referrer or through campaign/click parameters.
  // Anything else that arrives without a referrer stays as direct traffic.
  const getCampaignSource = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (GOOGLE_ADS_PARAMS.some((name) => params.has(name))) return "ads.google.com";
      if (params.has("srsltid")) return "google.com";
      const source = (params.get("utm_source") || "").trim().toLowerCase();
      if (!GOOGLE_CAMPAIGN_SOURCE.test(source)) return null;
      const medium = (params.get("utm_medium") || "").trim().toLowerCase();
      return /cpc|ppc|paid|ads/.test(medium) ? "ads.google.com" : "google.com";
    } catch {
      return null;
    }
  };

  // Keep the first source of the tab session so internal navigation is not counted
  // as direct traffic. A page reached from Google stays attributed to Google.
  const getSessionSource = () => {
    try {
      const stored = sessionStorage.getItem(sourceKey);
      if (stored) return stored;
    } catch {
      // sessionStorage may be blocked; fall back to per-page attribution.
    }
    const referrer = getReferrerDomain();
    const source = GOOGLE_APP_REFERRERS.has(referrer) ? "google.com" : referrer || getCampaignSource();
    if (source) {
      try {
        sessionStorage.setItem(sourceKey, source);
      } catch {
        // Ignore storage errors.
      }
    }
    return source;
  };

  const send = (eventType, keepalive = false) => {
    const source = eventType === "page_view" ? getSessionSource() : null;
    const body = {
      site_id: siteId,
      visitor_session_id: visitorSessionId,
      event_type: eventType,
      page_path: getPagePath(),
      ...(eventType === "page_view" ? { referrer_domain: source } : {}),
      ...(eventType === "page_exit"
        ? { page_duration_seconds: Math.min(86400, Math.floor((Date.now() - pageStartedAt) / 1000)) }
        : {}),
    };
    return fetch(`${endpoint}?site_id=${encodeURIComponent(siteId)}`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      keepalive,
      credentials: "omit",
    }).catch((error) => {
      console.warn("Vigia could not send an analytics event.", error);
    });
  };

  void send("page_view");
  window.setInterval(() => {
    if (document.visibilityState === "visible") void send("heartbeat");
  }, 25_000);
  window.addEventListener("pagehide", () => {
    void send("page_exit", true);
  }, { once: true });
})();
