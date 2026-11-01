(() => {
  "use strict";

  const script = document.currentScript;
  const siteId = script?.dataset.siteId;
  if (!siteId || !/^[0-9a-f-]{36}$/i.test(siteId)) return;

  const endpoint = "https://cmclojrcwjrfezoaidzw.supabase.co/functions/v1/vigia-ingest";
  const publishableKey = "sb_publishable_8rzmwGtqZz0PSo21n-h33Q_HZsfzOt5";
  const storageKey = `vigia-session:${siteId}`;

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

  let pageStartedAt = Date.now();
  const getPagePath = () => window.location.pathname.slice(0, 2048) || "/";
  const getReferrerDomain = () => {
    try {
      const referrer = new URL(document.referrer);
      return referrer.hostname === window.location.hostname ? null : referrer.hostname;
    } catch {
      return null;
    }
  };

  const send = (eventType, keepalive = false) => {
    const body = {
      site_id: siteId,
      visitor_session_id: visitorSessionId,
      event_type: eventType,
      page_path: getPagePath(),
      ...(eventType === "page_view" ? { referrer_domain: getReferrerDomain() } : {}),
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
