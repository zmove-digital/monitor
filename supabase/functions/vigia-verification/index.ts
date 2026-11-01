import {
  adminRequest,
  errorResponse,
  getAuthenticatedUser,
  getOwnedSite,
  jsonResponse,
  readJson,
  RequestError,
} from "../_shared/http.js";

const challengeLifetimeMs = 24 * 60 * 60 * 1000;

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const getDnsTxtAnswers = async (hostname) => {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", "TXT");
  const response = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!response.ok) throw new Error("DNS lookup failed.");
  const result = await response.json();
  return (result.Answer || [])
    .filter((answer) => answer.type === 16)
    .map((answer) => answer.data.replace(/^"|"$/g, "").replace(/"\s+"/g, ""));
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  try {
    const user = await getAuthenticatedUser(request);
    const body = await readJson(request);
    if (typeof body.site_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.site_id)) {
      throw new RequestError(400, "Site inválido.");
    }
    const site = await getOwnedSite(body.site_id, user.id);
    if (site.verified_at) {
      return jsonResponse({ verified: true, verified_at: site.verified_at });
    }

    if (body.action === "issue") {
      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const recordValue = `vigia-verification=${token}`;
      const expiresAt = new Date(Date.now() + challengeLifetimeMs).toISOString();
      await adminRequest("/rest/v1/site_verification_challenges?on_conflict=site_id", {
        method: "POST",
        body: {
          site_id: site.id,
          method: "dns_txt",
          token_digest: await sha256(recordValue),
          expires_at: expiresAt,
        },
      });
      return jsonResponse({
        verified: false,
        record_name: `_vigia.${site.domain}`,
        record_value: recordValue,
        expires_at: expiresAt,
      });
    }

    if (body.action !== "verify") throw new RequestError(400, "Ação de verificação inválida.");
    const challenges = await adminRequest(
      `/rest/v1/site_verification_challenges?site_id=eq.${encodeURIComponent(site.id)}&method=eq.dns_txt&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=token_digest&limit=1`,
    );
    if (!challenges?.length) throw new RequestError(409, "Desafio expirado ou inexistente. Gere um novo registro TXT.");

    const recordName = `_vigia.${site.domain}`;
    let answers;
    try {
      answers = await getDnsTxtAnswers(recordName);
    } catch {
      throw new RequestError(503, "Não foi possível consultar o DNS agora. Tente novamente em instantes.");
    }
    const matched = await Promise.all(answers.map(async (answer) => (await sha256(answer)) === challenges[0].token_digest));
    if (!matched.some(Boolean)) {
      return jsonResponse({
        verified: false,
        message: "O registro TXT ainda não foi encontrado. Aguarde a propagação do DNS e tente novamente.",
      }, 200);
    }

    const verifiedAt = new Date().toISOString();
    const siteParams = new URLSearchParams({
      id: `eq.${site.id}`,
      owner_id: `eq.${user.id}`,
      verified_at: "is.null",
    });
    await adminRequest(`/rest/v1/sites?${siteParams}`, {
      method: "PATCH",
      body: { verified_at: verifiedAt, verification_method: "dns_txt" },
    });
    await adminRequest(`/rest/v1/site_verification_challenges?site_id=eq.${encodeURIComponent(site.id)}`, {
      method: "DELETE",
    });
    return jsonResponse({ verified: true, verified_at: verifiedAt });
  } catch (error) {
    return errorResponse(error);
  }
});
