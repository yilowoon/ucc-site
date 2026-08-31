/* oauth.js — SNS 간편로그인(카카오·네이버·구글) OAuth 2.0 처리. 무의존(fetch 기반).
 * 필요한 환경변수(제공사 개발자센터에서 발급, 있는 것만 자동 활성화):
 *   카카오: KAKAO_REST_API_KEY [, KAKAO_CLIENT_SECRET]
 *   네이버: NAVER_LOGIN_CLIENT_ID, NAVER_LOGIN_CLIENT_SECRET
 *   구글:   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * 리다이렉트 URI(각 콘솔에 등록): {BASE_URL}/auth/{provider}/callback
 *   BASE_URL 미설정 시 요청 호스트로 자동 구성.
 */
"use strict";

const PROVIDERS = {
  kakao: {
    label: "카카오",
    id: () => process.env.KAKAO_REST_API_KEY || "",
    secret: () => process.env.KAKAO_CLIENT_SECRET || "",
    authUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    userUrl: "https://kapi.kakao.com/v2/user/me",
    // 카카오 scope는 쉼표(,)로 구분. 닉네임만 요청(가장 기본, 검수 불필요).
    // 이메일까지 받으려면 동의항목에서 account_email 을 '사용'으로 켠 뒤 "profile_nickname,account_email" 로 변경.
    scope: "profile_nickname",
  },
  naver: {
    label: "네이버",
    id: () => process.env.NAVER_LOGIN_CLIENT_ID || "",
    secret: () => process.env.NAVER_LOGIN_CLIENT_SECRET || "",
    authUrl: "https://nid.naver.com/oauth2.0/authorize",
    tokenUrl: "https://nid.naver.com/oauth2.0/token",
    userUrl: "https://openapi.naver.com/v1/nid/me",
    scope: "",
  },
  google: {
    label: "구글",
    id: () => process.env.GOOGLE_CLIENT_ID || "",
    secret: () => process.env.GOOGLE_CLIENT_SECRET || "",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
  },
};

function isEnabled(p) {
  const c = PROVIDERS[p];
  if (!c) return false;
  // 카카오는 REST 키만 있어도 가능, 네이버·구글은 id+secret 필요
  if (p === "kakao") return !!c.id();
  return !!(c.id() && c.secret());
}
function enabled() {
  return Object.keys(PROVIDERS).filter(isEnabled).map((key) => ({ key, label: PROVIDERS[key].label }));
}

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
  return `${proto}://${req.get("host")}`;
}
function callbackUrl(req, p) {
  return `${baseUrl(req)}/auth/${p}/callback`;
}

function authorizeUrl(p, state, redirectUri) {
  const c = PROVIDERS[p];
  const q = new URLSearchParams({
    response_type: "code",
    client_id: c.id(),
    redirect_uri: redirectUri,
    state,
  });
  if (c.scope) q.set("scope", c.scope);
  return `${c.authUrl}?${q.toString()}`;
}

async function fetchJson(url, opts, ms = 10000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { ok: r.ok, status: r.status, json: j, text: t };
  } finally { clearTimeout(to); }
}

// code → access token → 프로필. 반환: { providerId, email, name }
async function exchange(p, code, redirectUri, state) {
  const c = PROVIDERS[p];
  // 1) 토큰 교환
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: c.id(),
    redirect_uri: redirectUri,
    code,
  });
  if (c.secret()) body.set("client_secret", c.secret());
  if (p === "naver" && state) body.set("state", state);
  const tok = await fetchJson(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const accessToken = tok.json && tok.json.access_token;
  if (!accessToken) throw new Error(`토큰 교환 실패(${p}): ${tok.status} ${(tok.text || "").slice(0, 120)}`);

  // 2) 사용자 정보
  const info = await fetchJson(c.userUrl, { headers: { Authorization: "Bearer " + accessToken } });
  if (!info.ok || !info.json) throw new Error(`프로필 조회 실패(${p}): ${info.status}`);
  const d = info.json;

  if (p === "kakao") {
    const acc = d.kakao_account || {};
    return {
      providerId: String(d.id || ""),
      email: (acc.email || "").toLowerCase(),
      name: (acc.profile && acc.profile.nickname) || acc.name || "카카오회원",
    };
  }
  if (p === "naver") {
    const r = d.response || {};
    return {
      providerId: String(r.id || ""),
      email: (r.email || "").toLowerCase(),
      name: r.name || r.nickname || "네이버회원",
    };
  }
  // google
  return {
    providerId: String(d.sub || ""),
    email: (d.email || "").toLowerCase(),
    name: d.name || "구글회원",
  };
}

module.exports = { PROVIDERS, isEnabled, enabled, baseUrl, callbackUrl, authorizeUrl, exchange };
