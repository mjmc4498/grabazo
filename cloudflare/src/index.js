// Grabazo — Worker de credenciales TURN (copia del Worker de Presentazo).
//
//   GET /ice     → { iceServers, ttl }: credenciales temporales de Cloudflare Realtime TURN.
//   GET /estado  → consumo del mes y si la retransmisión está pausada.
//
// Cada 15 minutos (y al consultar /estado) se mide el consumo del mes. Si llega al
// límite configurado, la retransmisión se pausa y se revocan las credenciales que
// la estaban usando; se reactiva sola al empezar el mes siguiente. Mientras está
// pausada, Grabazo sigue funcionando con conexión directa.

const TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const GRAPHQL_API = 'https://api.cloudflare.com/client/v4/graphql';
const GB = 1024 ** 3;
const STATE_KEY = 'estado';
const STATE_MAX_AGE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- utilidades

function month(date = new Date()) {
  return date.toISOString().slice(0, 7); // AAAA-MM (UTC)
}

function allowedOrigin(origin, env) {
  if (!origin) return null;
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin;
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function json(body, status, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

// El ID de la clave tiene 32 caracteres hexadecimales y el API Token, 64. Se extraen
// aunque el secreto se haya guardado con texto adicional.
function turnKey(env) {
  const id = (String(env.TURN_KEY_ID || '').match(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i) || [])[0];
  const token = (String(env.TURN_KEY_API_TOKEN || '').match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i) || [])[0];
  return { id, token };
}

// Límite de pedidos: se frena si lo detecta el limitador oficial de Cloudflare
// (sincroniza con algunos segundos de retraso) o el contador en memoria.
const hits = new Map();
function memoryLimited(key) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > 60_000) {
    hits.set(key, { start: now, count: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}

async function rateLimited(env, key) {
  const local = memoryLimited(key);
  let official = false;
  if (env.LIMITADOR) {
    try {
      official = !(await env.LIMITADOR.limit({ key })).success;
    } catch {}
  }
  return local || official;
}

// ---------------------------------------------------------------- consumo y pausa

async function graphql(env, query) {
  const res = await fetch(GRAPHQL_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${String(env.CF_ANALYTICS_TOKEN).trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.errors?.length) {
    throw new Error(data?.errors?.[0]?.message || `GraphQL ${res.status}`);
  }
  return data.data.viewer.accounts[0]?.callsTurnUsageAdaptiveGroups || [];
}

function usageQuery(env, extra = '') {
  const now = new Date();
  const from = `${month(now)}-01`;
  const to = now.toISOString().slice(0, 10);
  return `query {
    viewer {
      accounts(filter: { accountTag: "${env.CF_ACCOUNT_ID}" }) {
        callsTurnUsageAdaptiveGroups(limit: 10000, filter: { date_geq: "${from}", date_leq: "${to}" }) {
          sum { egressBytes }
          ${extra}
        }
      }
    }
  }`;
}

// Revoca las credenciales que usaron la retransmisión este mes.
async function revokeActive(env) {
  const { id, token } = turnKey(env);
  if (!id || !token) return 0;
  let groups;
  try {
    groups = await graphql(env, usageQuery(env, 'dimensions { username }'));
  } catch {
    return 0; // Si no se pueden listar, igual expiran solas en pocas horas.
  }
  const users = [...new Set(groups.map((g) => g.dimensions?.username).filter(Boolean))].slice(0, 200);
  let revoked = 0;
  for (const user of users) {
    const res = await fetch(`${TURN_API}/${id}/credentials/${encodeURIComponent(user)}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (res && (res.status === 204 || res.ok)) revoked += 1;
  }
  return revoked;
}

async function readState(env) {
  const saved = await env.ESTADO.get(STATE_KEY, 'json').catch(() => null);
  if (!saved || saved.mes !== month()) return { mes: month(), pausado: false, usadoBytes: null, actualizado: null };
  return saved;
}

// Mide el consumo del mes y pausa la retransmisión si llegó al límite.
async function checkUsage(env) {
  const previous = await readState(env);
  const limitBytes = (Number(env.MONTHLY_LIMIT_GB) || 900) * GB;
  const state = { ...previous, mes: month(), limiteBytes: limitBytes, actualizado: new Date().toISOString() };

  if (!env.CF_ANALYTICS_TOKEN) {
    state.medicion = 'sin-token';
  } else {
    try {
      const groups = await graphql(env, usageQuery(env));
      state.usadoBytes = groups.reduce((total, g) => total + (g.sum?.egressBytes || 0), 0);
      state.medicion = 'activa';
      if (!previous.pausado && state.usadoBytes >= limitBytes) {
        state.pausado = true;
        state.pausadoDesde = state.actualizado;
        state.revocadas = await revokeActive(env);
      }
    } catch (err) {
      state.medicion = `error: ${String(err.message).slice(0, 120)}`;
    }
  }
  await env.ESTADO.put(STATE_KEY, JSON.stringify(state));
  return state;
}

function publicState(state) {
  const gb = (bytes) => (bytes == null ? null : Math.round((bytes / GB) * 100) / 100);
  return {
    mes: state.mes,
    usadoGB: gb(state.usadoBytes),
    limiteGB: gb(state.limiteBytes),
    pausado: !!state.pausado,
    medicion: state.medicion || 'pendiente',
    actualizado: state.actualizado,
  };
}

// ---------------------------------------------------------------- servidor

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request.headers.get('Origin'), env);
    const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';

    if (request.method === 'OPTIONS') return json({}, origin ? 204 : 403, origin);
    if (request.method !== 'GET') return json({ error: 'metodo-no-permitido' }, 405, origin);

    if (url.pathname === '/') return json({ servicio: 'Grabazo · credenciales TURN', ok: true }, 200, origin);

    if (url.pathname === '/estado') {
      if (await rateLimited(env, `estado:${ip}`)) return json({ error: 'demasiadas-solicitudes' }, 429, origin);
      let state = await readState(env);
      const age = state.actualizado ? Date.now() - Date.parse(state.actualizado) : Infinity;
      if (age > STATE_MAX_AGE_MS) state = await checkUsage(env);
      return json(publicState(state), 200, origin);
    }

    if (url.pathname !== '/ice') return json({ error: 'no-encontrado' }, 404, origin);
    if (!origin) return json({ error: 'origen-no-permitido' }, 403, null);
    if (await rateLimited(env, `ice:${ip}`)) return json({ error: 'demasiadas-solicitudes' }, 429, origin);

    const state = await readState(env);
    if (state.pausado) return json({ error: 'pausado-cuota-mensual', mes: state.mes }, 503, origin);

    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'sin-configurar' }, 503, origin);
    const { id, token } = turnKey(env);
    if (!id || !token) {
      return json({ error: 'clave-turn-invalida', revisar: [!id && 'TURN_KEY_ID', !token && 'TURN_KEY_API_TOKEN'].filter(Boolean) }, 503, origin);
    }

    const ttl = Math.max(600, Math.min(86400, Number(env.CREDENTIAL_TTL) || 14400));
    let res;
    try {
      res = await fetch(`${TURN_API}/${id}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl }),
      });
    } catch {
      return json({ error: 'cloudflare-no-disponible' }, 502, origin);
    }
    if (!res.ok) return json({ error: 'cloudflare-rechazo', estado: res.status }, 502, origin);

    const data = await res.json();
    // El puerto 53 puede tardar en los navegadores: se descarta.
    const iceServers = (data.iceServers || []).map((s) => ({
      ...s,
      urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
    })).filter((s) => s.urls.length);

    return json({ iceServers, ttl }, 200, origin);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkUsage(env));
  },
};
