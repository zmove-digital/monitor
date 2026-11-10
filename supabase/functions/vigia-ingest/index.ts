import {
  adminRequest,
  errorResponse,
  getOwnedSite,
  jsonResponse,
  readJson,
  RequestError,
} from "../_shared/http.js";

const isUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const getOriginHost = (origin) => {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
};

const getVerifiedSiteForOrigin = async (siteId, origin) => {
  if (!isUuid(siteId)) throw new RequestError(400, "Site inválido.");
  const site = await getOwnedSite(siteId);
  const originHost = getOriginHost(origin);
  if (!site.verified_at || !originHost || originHost !== site.domain.toLowerCase()) {
    throw new RequestError(403, "Origem não autorizada para este site verificado.");
  }
  return site;
};

const cleanPath = (value) => {
  if (typeof value !== "string" || value.length > 2048) throw new RequestError(400, "Página inválida.");
  try {
    const url = new URL(value, "https://vigia.invalid");
    if (url.origin !== "https://vigia.invalid") throw new Error("Unexpected origin");
    return url.pathname || "/";
  } catch {
    throw new RequestError(400, "Página inválida.");
  }
};

const isAllowedReferrer = (value) => typeof value === "string"
  && value.length <= 253
  && /^[a-z0-9.-]+$/i.test(value);

// City enrichment uses the request IP only for a momentary lookup. The IP itself is
// never persisted, logged by this code or exposed; only the coarse city/country is kept.
const geoCache = new Map();
const GEO_CACHE_TTL = 24 * 60 * 60 * 1000;
const GEO_CACHE_LIMIT = 8192;

const getClientIp = (request) => {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || (forwarded ? forwarded.split(",")[0].trim() : "");
  if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("192.168.")
    || ip.startsWith("10.") || ip.startsWith("172.16.") || ip.startsWith("fc") || ip.startsWith("fd")) {
    return null;
  }
  return ip;
};

const lookupGeo = async (ip) => {
  if (!ip) return null;
  const now = Date.now();
  const cached = geoCache.get(ip);
  if (cached && now - cached.ts < GEO_CACHE_TTL) return cached;
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`geo HTTP ${response.status}`);
    const data = await response.json();
    const city = typeof data?.city === "string" && data.city.length >= 1 && data.city.length <= 120
      ? data.city
      : null;
    const countryCode = typeof data?.country_code === "string" && /^[A-Z]{2}$/.test(data.country_code)
      ? data.country_code
      : null;
    if (!city && !countryCode) return null;
    if (geoCache.size >= GEO_CACHE_LIMIT) geoCache.clear();
    const entry = { city, countryCode, ts: now };
    geoCache.set(ip, entry);
    return entry;
  } catch (error) {
    console.warn("Vigia geo lookup skipped:", error.message);
    return null;
  }
};

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") {
    try {
      const siteId = new URL(request.url).searchParams.get("site_id");
      await getVerifiedSiteForOrigin(siteId, origin);
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "apikey, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Max-Age": "600",
          "Vary": "Origin",
        },
      });
    } catch (error) {
      return errorResponse(error, "null");
    }
  }
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405, "null");

  try {
    const body = await readJson(request);
    const site = await getVerifiedSiteForOrigin(body.site_id, origin);
    if (!isUuid(body.visitor_session_id)) throw new RequestError(400, "Sessão inválida.");
    const pagePath = cleanPath(body.page_path);
    const now = new Date().toISOString();
    const eventType = body.event_type;
    if (!["page_view", "page_exit", "heartbeat"].includes(eventType)) {
      throw new RequestError(400, "Tipo de evento inválido.");
    }

    const referrer = isAllowedReferrer(body.referrer_domain) && body.referrer_domain !== site.domain
      ? body.referrer_domain.toLowerCase()
      : null;

    // Only the coarse city/country survives; the raw IP never reaches the database.
    const geo = await lookupGeo(getClientIp(request));
    const geoFields = geo ? { country_code: geo.countryCode, city: geo.city } : {};

    if (eventType === "page_view" || eventType === "page_exit") {
      const duration = Number.isInteger(body.page_duration_seconds)
        ? Math.min(86400, Math.max(0, body.page_duration_seconds))
        : null;
      await adminRequest("/rest/v1/site_events", {
        method: "POST",
        body: {
          site_id: site.id,
          event_type: eventType,
          visitor_session_id: body.visitor_session_id,
          page_path: pagePath,
          occurred_at: now,
          ...(eventType === "page_exit" && duration !== null ? { page_duration_seconds: duration } : {}),
          ...(eventType === "page_view" && referrer ? { referrer_domain: referrer } : {}),
          ...geoFields,
        },
      });
    }

    if (eventType === "page_exit") {
      const params = new URLSearchParams({
        site_id: `eq.${site.id}`,
        visitor_session_id: `eq.${body.visitor_session_id}`,
        last_seen_at: `lte.${now}`,
      });
      await adminRequest(`/rest/v1/live_visitors?${params}`, { method: "DELETE" });
    } else {
      await adminRequest("/rest/v1/live_visitors?on_conflict=visitor_session_id", {
        method: "POST",
        body: {
          visitor_session_id: body.visitor_session_id,
          site_id: site.id,
          page_path: pagePath,
          last_seen_at: now,
          expires_at: new Date(Date.now() + 90_000).toISOString(),
          ...geoFields,
        },
      });
    }

    return jsonResponse({ accepted: true }, 200, origin);
  } catch (error) {
    const corsOrigin = error instanceof RequestError && error.status === 403 ? "null" : origin;
    return errorResponse(error, corsOrigin);
  }
});
