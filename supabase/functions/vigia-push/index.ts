import {
  adminRequest,
  errorResponse,
  getAuthenticatedUser,
  jsonResponse,
  readJson,
  RequestError,
} from "../_shared/http.js";

// Registers or removes the FCM token of the device owned by the signed-in user.
// The dashboard calls this with the user's access token (verify_jwt = true).

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  try {
    const user = await getAuthenticatedUser(request);
    const body = await readJson(request);

    if (body.action === "register") {
      if (typeof body.token !== "string" || body.token.length < 16 || body.token.length > 4096) {
        throw new RequestError(400, "Token de notificação inválido.");
      }
      await adminRequest("/rest/v1/push_tokens", {
        method: "POST",
        body: {
          token: body.token,
          user_id: user.id,
          enabled: true,
          updated_at: new Date().toISOString(),
        },
      });
      return jsonResponse({ ok: true });
    }

    if (body.action === "unregister") {
      if (typeof body.token === "string" && body.token.length) {
        await adminRequest(
          `/rest/v1/push_tokens?token=eq.${encodeURIComponent(body.token)}&user_id=eq.${user.id}`,
          { method: "DELETE" },
        );
      } else {
        // No token informed removes every device of the account (e.g. sign-out).
        await adminRequest(`/rest/v1/push_tokens?user_id=eq.${user.id}`, { method: "DELETE" });
      }
      return jsonResponse({ ok: true });
    }

    throw new RequestError(400, "Ação de notificação inválida.");
  } catch (error) {
    return errorResponse(error);
  }
});
