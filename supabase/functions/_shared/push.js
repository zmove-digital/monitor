import { adminRequest } from "./http.js";

// Firebase Cloud Messaging (HTTP v1) helper. Credentials come from the
// FIREBASE_SERVICE_ACCOUNT_JSON secret; when it is absent, push sending is
// skipped silently so the ingest pipeline keeps working without notifications.

let cachedAccessToken = null;

const getServiceAccount = () => {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    return parsed;
  } catch (error) {
    console.error("Vigia push: FIREBASE_SERVICE_ACCOUNT_JSON inválido.", error.message);
    return null;
  }
};

const base64UrlEncode = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const signJwt = async (serviceAccount) => {
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const pem = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
};

const getAccessToken = async (serviceAccount) => {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.exp > now + 60) return cachedAccessToken.value;
  const assertion = await signJwt(serviceAccount);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`Concessão do token Google falhou (HTTP ${response.status}).`);
  }
  const data = await response.json();
  cachedAccessToken = {
    value: data.access_token,
    exp: now + (data.expires_in ?? 3600),
  };
  return cachedAccessToken.value;
};

export const sendPushToUsers = async (userIds, { title, body, data = {} }) => {
  const ownerList = [...new Set(userIds)].filter(Boolean);
  if (!ownerList.length) return false;
  const serviceAccount = getServiceAccount();
  if (!serviceAccount) return false;

  const ids = ownerList.map((id) => `"${id}"`).join(",");
  const tokenRows = await adminRequest(
    `/rest/v1/push_tokens?user_id=in.(${ids})&enabled=eq.true&select=token`,
  );
  if (!tokenRows?.length) return false;

  const accessToken = await getAccessToken(serviceAccount);
  let delivered = false;
  await Promise.all(tokenRows.map(async ({ token }) => {
    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              android: { priority: "high" },
              data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
            },
          }),
        },
      );
      if (response.ok) {
        delivered = true;
        return;
      }
      // 404/410: the token is no longer registered on FCM; drop it so future
      // dispatches don't retry a dead registration.
      if (response.status === 404 || response.status === 410) {
        await adminRequest(`/rest/v1/push_tokens?token=eq.${encodeURIComponent(token)}`, { method: "DELETE" });
        return;
      }
      console.warn("Vigia push dispatch failed:", response.status, await response.text());
    } catch (error) {
      console.warn("Vigia push dispatch error:", error.message);
    }
  }));
  return delivered;
};
