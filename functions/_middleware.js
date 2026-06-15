const COOKIE_NAME = "__Host-e4a_session";
const SESSION_QUERY_PARAM = "session_id";
const DEFAULT_PORTAL_LOGIN_URL = "https://www.zoni.edu/portal";
const COOKIE_VERSION = "v1";
const REVALIDATE_AFTER_SECONDS = 5 * 60;
const MAX_SESSION_SECONDS = 8 * 60 * 60;
const AES_GCM_IV_BYTES = 12;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sessionId = normalizeSessionId(url.searchParams.get(SESSION_QUERY_PARAM));

  if (sessionId) {
    return handleSessionQuery(context, sessionId, url);
  }

  const sessionCookie = parseCookie(request.headers.get("Cookie") || "")[COOKIE_NAME];
  if (sessionCookie) {
    return handleSessionCookie(context, sessionCookie);
  }

  return redirectToPortal(env);
}

async function handleSessionQuery(context, sessionId, url) {
  const validation = await validatePortalSession(context.env, sessionId);
  if (!validation.valid) {
    return redirectToPortal(context.env);
  }

  const cookie = await buildSessionCookie(context.env, sessionId, validation);
  if (!cookie) {
    return redirectToPortal(context.env);
  }

  const cleanUrl = new URL(url);
  cleanUrl.searchParams.delete(SESSION_QUERY_PARAM);

  const response = redirectResponse(cleanUrl.toString());
  response.headers.append("Set-Cookie", cookie);
  applyProtectedHeaders(response);
  return response;
}

async function handleSessionCookie(context, cookieValue) {
  const payload = await decryptSessionCookie(context.env, cookieValue);
  const now = Date.now();
  if (!payload || !payload.sid || !Number.isFinite(payload.exp) || payload.exp <= now) {
    return redirectToPortal(context.env, true);
  }

  if (Number.isFinite(payload.nextCheck) && payload.nextCheck > now) {
    return protectedAssetResponse(await context.next());
  }

  const validation = await validatePortalSession(context.env, payload.sid);
  if (!validation.valid) {
    return redirectToPortal(context.env, true);
  }

  const refreshedCookie = await buildSessionCookie(context.env, payload.sid, validation);
  if (!refreshedCookie) {
    return redirectToPortal(context.env, true);
  }

  return protectedAssetResponse(await context.next(), refreshedCookie);
}

async function validatePortalSession(env, sessionId) {
  if (!env.VALIDATE_SESSION_URL || !env.VALIDATE_SESSION_TOKEN) {
    console.warn("E4A auth is missing VALIDATE_SESSION_URL or VALIDATE_SESSION_TOKEN.");
    return { valid: false };
  }

  try {
    const response = await fetch(env.VALIDATE_SESSION_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${env.VALIDATE_SESSION_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sessionId })
    });

    if (!response.ok) {
      console.warn(`E4A auth validation failed with HTTP ${response.status}.`);
      return { valid: false };
    }

    const result = await response.json();
    const data = result && result.data;
    const content = data && data.content;
    const valid = result && result.success === true && data && data.valid === true;
    return {
      valid,
      expTimeISO: content && (content.expTimeISO || content.expTime)
    };
  } catch (error) {
    console.warn("E4A auth validation request failed.", error);
    return { valid: false };
  }
}

async function buildSessionCookie(env, sessionId, validation) {
  const now = Date.now();
  const maxExpiry = now + MAX_SESSION_SECONDS * 1000;
  const portalExpiry = Date.parse(validation.expTimeISO || "");
  const expiresAt = Number.isFinite(portalExpiry) ? Math.min(portalExpiry, maxExpiry) : maxExpiry;
  if (expiresAt <= now) {
    return null;
  }

  const payload = {
    sid: sessionId,
    exp: expiresAt,
    nextCheck: Math.min(now + REVALIDATE_AFTER_SECONDS * 1000, expiresAt)
  };
  let value;
  try {
    value = await encryptSessionCookie(env, payload);
  } catch (error) {
    console.warn("E4A auth cookie could not be created.", error);
    return null;
  }

  const maxAge = Math.max(0, Math.floor((expiresAt - now) / 1000));
  return `${COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function encryptSessionCookie(env, payload) {
  const key = await getCookieCryptoKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  );
  return `${COOKIE_VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

async function decryptSessionCookie(env, value) {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== COOKIE_VERSION) {
    return null;
  }

  try {
    const key = await getCookieCryptoKey(env);
    const iv = base64UrlDecode(parts[1]);
    const ciphertext = base64UrlDecode(parts[2]);
    if (iv.byteLength !== AES_GCM_IV_BYTES) {
      return null;
    }

    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(textDecoder.decode(plaintext));
  } catch (error) {
    console.warn("E4A auth cookie could not be decrypted.", error);
    return null;
  }
}

async function getCookieCryptoKey(env) {
  if (!env.AUTH_COOKIE_SECRET) {
    throw new Error("Missing AUTH_COOKIE_SECRET.");
  }
  const secretBytes = textEncoder.encode(env.AUTH_COOKIE_SECRET);
  const digest = await crypto.subtle.digest("SHA-256", secretBytes);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function redirectToPortal(env, clearCookie = false) {
  const loginUrl = env.PORTAL_LOGIN_URL || DEFAULT_PORTAL_LOGIN_URL;
  const response = redirectResponse(loginUrl);
  if (clearCookie) {
    response.headers.append("Set-Cookie", clearSessionCookie());
  }
  applyProtectedHeaders(response);
  return response;
}

function redirectResponse(location) {
  return new Response(null, {
    status: 302,
    headers: {
      "Location": location
    }
  });
}

function protectedAssetResponse(response, setCookie) {
  const protectedResponse = new Response(response.body, response);
  if (setCookie) {
    protectedResponse.headers.append("Set-Cookie", setCookie);
  }
  applyProtectedHeaders(protectedResponse);
  return protectedResponse;
}

function applyProtectedHeaders(response) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function normalizeSessionId(value) {
  const normalized = value && value.trim();
  return normalized || "";
}

function parseCookie(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies[name] = value;
    }
  }
  return cookies;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
