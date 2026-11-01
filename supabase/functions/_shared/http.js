export function jsonResponse(body, status = 200, origin = "*", extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin",
      ...extraHeaders,
    },
  });
}

export function errorResponse(error, origin = "*") {
  if (error instanceof RequestError) {
    return jsonResponse({ error: error.message }, error.status, origin);
  }
  console.error("Vigia function error:", error);
  return jsonResponse({ error: "Erro interno. Tente novamente mais tarde." }, 500, origin);
}

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) throw new RequestError(413, "A requisição excede o tamanho permitido.");
  try {
    return await request.json();
  } catch {
    throw new RequestError(400, "Corpo JSON inválido.");
  }
}

export function getSupabaseConfig() {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) throw new Error("Supabase function environment is incomplete.");
  return { url: url.replace(/\/+$/, ""), anonKey, serviceKey };
}

export async function adminRequest(path, { method = "GET", body } = {}) {
  const { url, serviceKey } = getSupabaseConfig();
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "POST" ? { Prefer: "return=representation,resolution=merge-duplicates" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    console.error("Supabase admin request failed:", response.status, data);
    throw new Error("Não foi possível concluir a operação no banco de dados.");
  }
  return data;
}

export async function getAuthenticatedUser(request) {
  const authorization = request.headers.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) throw new RequestError(401, "Entre na sua conta Vigia.");

  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${tokenMatch[1]}`,
    },
  });
  if (!response.ok) throw new RequestError(401, "Sua sessão expirou. Entre novamente.");
  return await response.json();
}

export function siteQuery(siteId, ownerId) {
  const query = new URLSearchParams({
    select: "id,owner_id,domain,verified_at",
    id: `eq.${siteId}`,
  });
  if (ownerId) query.set("owner_id", `eq.${ownerId}`);
  query.set("limit", "1");
  return `/rest/v1/sites?${query}`;
}

export async function getOwnedSite(siteId, ownerId) {
  const sites = await adminRequest(siteQuery(siteId, ownerId));
  if (!sites?.length) throw new RequestError(404, "Site não encontrado nesta conta.");
  return sites[0];
}
