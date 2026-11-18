const COOKIE_NAME = '__Host-duty_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_PATH = '/__access/login';
const SETUP_MESSAGE = '值班工作台尚未配置访问密钥。请部署者按仓库 README 设置 Cloudflare Pages 部署密钥，再重新部署。';
const LOGOUT_PATH = '/__access/logout';
const MAX_FORM_BYTES = 2048;
const encoder = new TextEncoder();
const passwordMessage = encoder.encode('duty-workbench:access:v1');
const hex256 = /^[0-9a-f]{64}$/;

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return Uint8Array.from(hex.match(/../g), (byte) => Number.parseInt(byte, 16));
}

function importHmac(bytes, usage) {
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

function protect(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function loginPage(message = '') {
  return new Response(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>访问值班工作台</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:#f3f7f1;color:#1b3a2b;font:16px/1.55 system-ui,"Microsoft YaHei",sans-serif}
main{width:min(100%,420px);padding:clamp(22px,7vw,38px);background:#fff;border:1px solid #dce8dd;border-top:5px solid #39806a;border-radius:19px;box-shadow:0 18px 52px #1b3a2b12}
h1{margin:4px 0 20px;font-size:1.8rem;line-height:1.2}
label{display:grid;gap:7px;font-weight:600}
input,button{width:100%;padding:11px 13px;border-radius:9px;font:inherit}
input{min-height:46px;border:1px solid #97ad9f;color:inherit}
button{margin-top:13px;border:0;background:#215b42;color:#fff;font-weight:650;cursor:pointer}
:focus-visible{outline:3px solid #58a087;outline-offset:3px}
.hint{margin:12px 0 0;color:#496256;font-size:.86rem}
.error{padding:8px 11px;border-radius:7px;background:#fff1e8;color:#823918;font-size:.92rem}
</style></head><body><main>
<h1>值班工作台</h1>
${message ? `<p class="error" role="alert">${message}</p>` : ''}
<form action="${LOGIN_PATH}" method="post" accept-charset="UTF-8">
<label>访问密钥
<input name="key" type="text" inputmode="text" autocomplete="off" autocapitalize="none"
  autocorrect="off" spellcheck="false" required maxlength="128" aria-describedby="key-hint session-hint">
</label>
<p id="key-hint" class="hint">请输入部署者提供的访问密钥，支持粘贴中文。</p>
<button type="submit">进入工作台</button>
<p id="session-hint" class="hint">此浏览器会保留登录状态 30 天。</p>
</form></main></body></html>`, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function sessionCookie(value, maxAge) {
  return `${COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function sessionMessage(env, url, expires) {
  return encoder.encode(`${url.origin}|${env.DUTY_ACCESS_PROOF}|${expires}`);
}

async function validSession(request, env, url) {
  const cookie = request.headers.get('Cookie')?.split(/;\s*/).find((value) => value.startsWith(`${COOKIE_NAME}=`));
  const match = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(cookie?.slice(COOKIE_NAME.length + 1) || '');
  if (!match || Number(match[1]) <= Math.floor(Date.now() / 1000)) return false;
  const key = await importHmac(fromHex(env.DUTY_SESSION_KEY), ['verify']);
  return crypto.subtle.verify('HMAC', key, fromHex(match[2]), sessionMessage(env, url, match[1]));
}

async function readAccessKey(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const data = new Uint8Array(MAX_FORM_BYTES);
  let offset = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (offset + value.length > data.length) {
      await reader.cancel();
      return '';
    }
    data.set(value, offset);
    offset += value.length;
  }
  return new URLSearchParams(new TextDecoder().decode(data.subarray(0, offset))).get('key') || '';
}

async function login(request, env, url) {
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') return new Response('Unsupported Media Type', { status: 415 });
  const password = await readAccessKey(request);
  if (password && password.length <= 128) {
    const proofKey = await importHmac(encoder.encode(password), ['verify']);
    if (await crypto.subtle.verify('HMAC', proofKey, fromHex(env.DUTY_ACCESS_PROOF), passwordMessage)) {
      const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
      const key = await importHmac(fromHex(env.DUTY_SESSION_KEY), ['sign']);
      const signature = await crypto.subtle.sign('HMAC', key, sessionMessage(env, url, expires));
      return redirect(sessionCookie(`${expires}.${toHex(signature)}`, SESSION_SECONDS));
    }
  }
  return loginPage('密钥不正确，请核对后重试。');
}

function redirect(cookie) {
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': cookie } });
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('使用 HTTPS 访问。', { status: 400 });
    url.protocol = 'https:';
    return Response.redirect(url.href, 308);
  }
  if (!hex256.test(env.DUTY_ACCESS_PROOF || '') || !hex256.test(env.DUTY_SESSION_KEY || '')) {
    return new Response(SETUP_MESSAGE, { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (url.pathname === LOGIN_PATH || url.pathname === LOGOUT_PATH) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
    if (request.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403 });
    if (url.pathname === LOGOUT_PATH) return redirect(sessionCookie('', 0));
    return login(request, env, url);
  }
  if (await validSession(request, env, url)) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const headers = new Headers(request.headers);
      headers.delete('Cookie');
      return env.ASSETS.fetch(new Request(request, { headers }));
    }
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (url.pathname === '/' && request.method === 'GET') return loginPage();
  return new Response('Authentication required', { status: 401 });
}

export default {
  async fetch(request, env) {
    try {
      return protect(await handle(request, env));
    } catch {
      return protect(new Response('访问暂不可用。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    }
  },
};
