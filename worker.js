/* EstudaIA — Cloudflare Worker
   GET  /api/chat -> { ok, ai, limited, resetAt, retryAfter }
   POST /api/chat -> resposta em streaming (texto puro)
   Todo o resto é servido pelos arquivos estáticos da pasta /public.

   IA gratuita, em ordem de tentativa (passa para a próxima quando a anterior esgota):
     1. Groq  — GROQ_API_KEY, modelo GROQ_MODEL (padrão llama-3.3-70b-versatile)
     2. Groq  — mesmo GROQ_API_KEY, modelo GROQ_FALLBACK_MODEL (padrão llama-3.1-8b-instant)
     3. NVIDIA — NVIDIA_API_KEY, modelo NVIDIA_MODEL (padrão meta/llama-3.3-70b-instruct)
   Sem Groq nem NVIDIA, usa ANTHROPIC_API_KEY (paga) se existir.
   Quando tudo esgota, responde 429 com { error: "exhausted", retryAfter, resetAt }.
   Opcionais: ALLOWED_ORIGIN, RATE_LIMIT_PER_10MIN. */
import core from "./tutor-core.js";

const URLS = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages"
};

/* ---------- lista de motores disponíveis ---------- */
function engines(env) {
  const list = [];
  if (env.GROQ_API_KEY) {
    list.push({ id: "groq:a", kind: "groq", key: env.GROQ_API_KEY, model: env.GROQ_MODEL || "llama-3.3-70b-versatile" });
    list.push({ id: "groq:b", kind: "groq", key: env.GROQ_API_KEY, model: env.GROQ_FALLBACK_MODEL || "llama-3.1-8b-instant" });
  }
  if (env.NVIDIA_API_KEY) {
    list.push({ id: "nvidia", kind: "nvidia", key: env.NVIDIA_API_KEY, model: env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct" });
  }
  if (!list.length && env.ANTHROPIC_API_KEY) {
    list.push({ id: "anthropic", kind: "anthropic", key: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL || core.DEFAULT_MODEL });
  }
  return list;
}

/* ---------- esgotamento: guarda até quando cada motor está bloqueado ---------- */
const cooldowns = new Map(); // id -> timestamp (ms) em que volta
const DEFAULT_WAIT_S = 60;

function parseDuration(v) { // "2m59.56s", "7.66s", "1h2m3s", "30"
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  let total = 0, found = false;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s|d)/g;
  let m;
  while ((m = re.exec(s))) {
    found = true;
    const n = Number(m[1]);
    total += m[2] === "d" ? n * 86400 : m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : m[2] === "ms" ? n / 1000 : n;
  }
  return found ? total : null;
}

function waitFromHeaders(h) {
  const ra = parseDuration(h.get("retry-after"));
  if (ra != null) return ra;
  const cands = [h.get("x-ratelimit-reset-tokens"), h.get("x-ratelimit-reset-requests")]
    .map(parseDuration).filter((x) => x != null);
  return cands.length ? Math.max(...cands) : DEFAULT_WAIT_S;
}

function status(list) {
  const now = Date.now();
  const waits = list.map((e) => cooldowns.get(e.id) || 0);
  const limited = list.length > 0 && waits.every((t) => t > now);
  const resetAtMs = limited ? Math.min(...waits) : null;
  return {
    limited,
    resetAt: resetAtMs ? new Date(resetAtMs).toISOString() : null,
    retryAfter: resetAtMs ? Math.max(1, Math.ceil((resetAtMs - now) / 1000)) : 0
  };
}

/* ---------- limite por pessoa (IP), melhor esforço ---------- */
const hits = new Map();
function ipLimit(ip, env) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = Number(env.RATE_LIMIT_PER_10MIN || 40);
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 3000) hits.clear();
  if (arr.length <= max) return 0;
  return Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000));
}

function originAllowed(origin, env) {
  const allowed = env.ALLOWED_ORIGIN;
  if (!allowed || !origin) return true;
  return allowed.split(",").map((s) => s.trim()).includes(origin);
}

const json = (code, obj, extra) =>
  new Response(JSON.stringify(obj), {
    status: code,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, extra || {})
  });

/* ---------- chamada ao provedor ---------- */
function buildRequest(e, system, messages, max_tokens) {
  if (e.kind === "anthropic") {
    return {
      url: URLS.anthropic,
      headers: { "content-type": "application/json", "x-api-key": e.key, "anthropic-version": "2023-06-01" },
      body: { model: e.model, max_tokens, system, messages, stream: true }
    };
  }
  return {
    url: URLS[e.kind],
    headers: { "content-type": "application/json", authorization: "Bearer " + e.key },
    body: {
      model: e.model,
      max_tokens,
      temperature: 0.6,
      messages: [{ role: "system", content: system }, ...messages],
      stream: true
    }
  };
}

/* lê o streaming (SSE) no formato OpenAI (Groq e NVIDIA) e entrega só o texto */
async function readOpenAIStream(response, onText) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const evt = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of evt.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (t) onText(t);
        } catch (err) { /* pedaço incompleto: ignora */ }
      }
    }
  }
}

async function handleChat(request, env, ctx) {
  if (!originAllowed(request.headers.get("origin"), env)) return json(403, { error: "origin" });

  const list = engines(env);
  if (request.method === "GET") {
    const st = status(list);
    return json(200, { ok: true, ai: list.length > 0, limited: st.limited, resetAt: st.resetAt, retryAfter: st.retryAfter });
  }
  if (request.method !== "POST") return json(405, { error: "method" });
  if (!list.length) return json(501, { error: "no_key" });

  const ip = request.headers.get("cf-connecting-ip") || "?";
  const wait = ipLimit(ip, env);
  if (wait) return json(429, { error: "rate_limited", retryAfter: wait, resetAt: new Date(Date.now() + wait * 1000).toISOString() }, { "retry-after": String(wait) });

  let body = null;
  try { body = await request.json(); } catch (e) {}
  body = body || {};
  const messages = core.cleanMessages(body.messages, 24, 10000);
  if (!messages.length) return json(400, { error: "Mensagem vazia." });
  const s = body.settings || {};
  const system = core.buildSystem(s);
  const max_tokens = core.maxTokens(s.length);

  let up = null, used = null;
  const fails = []; // diagnóstico: o que cada motor respondeu (sem chaves)
  for (const e of list) {
    if ((cooldowns.get(e.id) || 0) > Date.now()) continue;
    const req = buildRequest(e, system, messages, max_tokens);
    let r;
    try {
      r = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) });
    } catch (err) {
      fails.push({ engine: e.id + ":" + e.model, status: 0, message: String(err && err.message || err).slice(0, 200) });
      continue;
    }
    if (r.ok) { up = r; used = e; break; }
    if (r.status === 429 || r.status === 413) {
      cooldowns.set(e.id, Date.now() + waitFromHeaders(r.headers) * 1000);
    } else {
      // chave inválida, modelo inexistente, provedor fora do ar etc.: registra e tenta o próximo
      let msg = "";
      try { msg = (await r.text()).slice(0, 300); } catch (err) {}
      fails.push({ engine: e.id + ":" + e.model, status: r.status, message: msg });
      console.log("falha no motor", e.id, r.status, msg);
    }
  }

  if (!up) {
    const st = status(list);
    if (st.limited) {
      return json(429, { error: "exhausted", retryAfter: st.retryAfter, resetAt: st.resetAt }, { "retry-after": String(st.retryAfter) });
    }
    return json(502, { error: fails.length ? "upstream" : "unavailable", details: fails });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  ctx.waitUntil(
    (async () => {
      try {
        const send = (chunk) => writer.write(enc.encode(chunk));
        if (used.kind === "anthropic") await core.readAnthropicStream(up, send);
        else await readOpenAIStream(up, send);
      } catch (err) { /* cliente fechou a conexão */ }
      try { await writer.close(); } catch (err) {}
    })()
  );

  return new Response(readable, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      "x-estudaia-engine": used.kind + ":" + used.model
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return handleChat(request, env, ctx);
    if (url.pathname.startsWith("/api/")) return json(404, { error: "not_found" });
    return env.ASSETS.fetch(request);
  }
};
