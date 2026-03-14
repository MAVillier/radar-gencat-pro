import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'snapshot.json');

const URLS = {
  pub: 'https://analisi.transparenciacatalunya.cat/resource/ybgg-dgi6.json',
  exe: 'https://analisi.transparenciacatalunya.cat/resource/8idu-wkjv.json',
  plan: 'https://analisi.transparenciacatalunya.cat/resource/u9d7-egbx.json',
  awd: 'https://analisi.transparenciacatalunya.cat/resource/nn7v-4yxe.json'
};

const now = new Date();
const ISO_NOW = now.toISOString();
const LAST_60_DAYS = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
const LAST_365_DAYS = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(v = '') {
  return String(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function get(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== '') {
      return obj[key];
    }
  }
  return null;
}

function findAny(obj, regex) {
  for (const [key, value] of Object.entries(obj || {})) {
    if (regex.test(key) && value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(
    String(v)
      .replace(/\./g, '')
      .replace(/,/g, '.')
      .replace(/[^0-9.-]/g, '')
  );
  return Number.isFinite(n) ? n : null;
}

function inferDate(o) {
  return (
    get(o, [
      'data_publicacio',
      'data_publicacio_anunci',
      'data_publicaci',
      'data_d_adjudicacio',
      'data_adjudicacio',
      'data_formalitzacio',
      'data_inici',
      'data_prevista'
    ]) ||
    findAny(o, /^data_/i) ||
    null
  );
}

function inferUrl(o) {
  return (
    get(o, [
      'url_expedient',
      'url_publicacio',
      'url_publicaci',
      'enllac_expedient',
      'enllac',
      'link'
    ]) ||
    findAny(o, /(url|enllac|link)/i) ||
    null
  );
}

function inferTitle(o) {
  return (
    get(o, [
      'descripcio_contracte',
      'descripci_del_contracte',
      'descripcio_del_contracte',
      'objecte_contracte',
      'objecte_del_lot',
      'titol',
      'descripcio'
    ]) || 'Sense títol'
  );
}

function inferOrgan(o) {
  return (
    get(o, [
      'nom_organ',
      'organ_de_contractaci',
      'orga_de_contractaci',
      'organ'
    ]) || 'Sense organisme'
  );
}

function inferScope(o) {
  return (
    get(o, [
      'nom_ambit',
      'ambit',
      'departament',
      'nom_departament',
      'departament_d_adscripci',
      'departament_d_adscripcio',
      'nom_departament_ens'
    ]) || ''
  );
}

function inferExpedient(o) {
  return get(o, ['codi_expedient', 'codi_d_expedient', 'expedient']) || '';
}

function inferCPV(o) {
  return get(o, ['codi_cpv', 'cpv', 'cpv_principal']) || '';
}

function inferAmount(o) {
  return (
    get(o, [
      'import_licitacio',
      'import_de_licitacio',
      'import_licitat',
      'valor_estimat_contracte',
      'pressupost_base_licitacio',
      'import_previst_sense_iva',
      'import_previst',
      'import_adjudicat_sense_iva',
      'import_adjudicat',
      'import'
    ]) || null
  );
}

function inferStatus(o) {
  const txt = normalizeText(
    Object.entries(o || {})
      .filter(([k]) => /(tipus|fase|publicaci|estat|anunci)/i.test(k))
      .map(([, v]) => String(v))
      .join(' | ')
  );

  if (txt.includes('consulta preliminar')) return 'consulta';
  if (txt.includes('anunci previ')) return 'previ';
  if (txt.includes('execuc')) return 'execucio';
  if (txt.includes('formalitz')) return 'formalitzacio';
  if (txt.includes('adjudic')) return 'adjudicacio';
  if (txt.includes('avalu')) return 'avaluacio';
  if (txt.includes('licit')) return 'licitacio';

  return 'licitacio';
}

function inferAlertShort(o) {
  const txt = normalizeText(
    Object.entries(o || {})
      .filter(([k]) => /(tipus|fase|publicaci|estat|anunci|titol|descripcio)/i.test(k))
      .map(([, v]) => String(v))
      .join(' | ')
  );

  if (txt.includes('rectif') || txt.includes('esmena')) return 'Plecs rectificats';
  if (txt.includes('ampli')) return 'Termini ampliat';
  if (txt.includes('dubte') || txt.includes('pregunt')) return 'Dubtes resolts';
  if (txt.includes('adjudic')) return 'Adjudicació publicada';
  if (txt.includes('formalitz')) return 'Contracte formalitzat';
  if (txt.includes('avalu')) return 'En avaluació';
  if (txt.includes('consulta preliminar')) return 'Consulta mercat';
  if (txt.includes('anunci previ')) return 'Anunci previ';
  if (txt.includes('execuc')) return 'En execució';
  if (txt.includes('licit')) return 'Licitació oberta';

  return 'Actualització expedient';
}

function isTargetRecord(organ, scope) {
  const txt = normalizeText(`${organ || ''} ${scope || ''}`);
  return (
    txt.includes('generalitat') ||
    txt.includes('departament') ||
    txt.includes('centre de telecomunicacions') ||
    txt.includes('ctti') ||
    txt.includes('institut catal') ||
    txt.includes('servei catal') ||
    txt.includes('agencia') ||
    txt.includes('agència') ||
    txt.includes('ferrocarrils') ||
    txt.includes('infraestructures')
  );
}

function tokens(t) {
  return new Set(
    normalizeText(t)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(
        (x) =>
          x.length > 2 &&
          ![
            'de',
            'la',
            'el',
            'les',
            'del',
            'dels',
            'amb',
            'per',
            'servei',
            'serveis',
            'contracte',
            'contractes',
            'subministrament',
            'suport',
            'oficina',
            'tecnica',
            'tecnica'
          ].includes(x)
      )
  );
}

function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let same = 0;
  for (const x of A) if (B.has(x)) same++;
  return same / Math.max(4, Math.min(A.size, B.size));
}

function statusPriority(status) {
  return (
    {
      licitacio: 8,
      avaluacio: 7,
      adjudicacio: 6,
      formalitzacio: 5,
      execucio: 4,
      consulta: 3,
      previ: 2,
      programada: 1
    }[status] || 0
  );
}

function priorityLabel(item) {
  let score = 0;
  if (normalizeText(`${item.organ} ${item.scope}`).includes('ctti')) score += 25;
  if (item.signals?.count) score += 20;
  if (item.incumbent?.provider) score += 20;
  if ((item.alerts?.count || 0) > 3) score += 10;
  if ((item.amount || 0) > 1_000_000) score += 15;
  if (item.programmed?.matched) score += 10;

  if (score >= 70) return 'Oportunitat alta';
  if (score >= 45) return 'Seguiment prioritari';
  return 'Seguiment';
}

async function fetchJsonWithRetry(url, params = {}, options = {}) {
  const {
    retries = 5,
    timeoutMs = 30000,
    baseDelayMs = 1500
  } = options;

  const qs = new URLSearchParams(params);
  const fullUrl = `${url}?${qs.toString()}`;

  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(fullUrl, {
        headers: { accept: 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status} ${res.statusText} -> ${fullUrl}\n${body}`);
        err.status = res.status;
        throw err;
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      const msg = String(err?.message || err);
      const retriable =
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('AbortError') ||
        msg.includes('fetch failed') ||
        msg.includes('network') ||
        err?.status === 429 ||
        (err?.status >= 500 && err?.status < 600);

      if (!retriable || attempt === retries) {
        throw lastError;
      }

      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError;
}

async function safeFetch(name, url, params) {
  try {
    return await fetchJsonWithRetry(url, params);
  } catch (err) {
    console.warn(`[WARN] ${name} ha fallat: ${err?.message || err}`);
    return [];
  }
}

function normalizePub(o) {
  return {
    source: 'pub',
    status: inferStatus(o),
    title: inferTitle(o),
    organ: inferOrgan(o),
    scope: inferScope(o),
    expedient: inferExpedient(o),
    cpv: inferCPV(o),
    amount: toNumber(inferAmount(o)),
    date: inferDate(o),
    url: inferUrl(o),
    short: inferAlertShort(o),
    raw: o
  };
}

function normalizeExe(o) {
  return {
    source: 'exe',
    status: 'execucio',
    title: inferTitle(o),
    organ: inferOrgan(o),
    scope: inferScope(o),
    expedient: inferExpedient(o),
    cpv: inferCPV(o),
    amount: toNumber(inferAmount(o)),
    date: inferDate(o),
    url: inferUrl(o),
    short: 'En execució',
    raw: o
  };
}

function normalizePlan(o) {
  return {
    source: 'plan',
    status: 'programada',
    title: inferTitle(o),
    organ: inferOrgan(o),
    scope: inferScope(o),
    expedient: inferExpedient(o),
    cpv: inferCPV(o),
    amount: toNumber(inferAmount(o)),
    date: inferDate(o) || '2026-01-01T00:00:00Z',
    url: inferUrl(o),
    short: 'Programació 2026',
    raw: o
  };
}

function normalizeAwd(o) {
  const licitat = toNumber(get(o, ['import_licitat', 'import_licitacio']));
  const adjudicat = toNumber(get(o, ['import_adjudicat_sense_iva', 'import_adjudicat']));

  return {
    source: 'awd',
    title: inferTitle(o),
    organ: inferOrgan(o),
    scope: inferScope(o),
    expedient: inferExpedient(o),
    cpv: inferCPV(o),
    licitat,
    adjudicat,
    provider: get(o, ['empresa_adjudicat_ria', 'empresa_adjudicataria', 'adjudicatari']) || '',
    date: inferDate(o),
    url: inferUrl(o),
    discount_pct:
      licitat && adjudicat && licitat > 0 ? ((licitat - adjudicat) / licitat) * 100 : null,
    raw: o
  };
}

function keyFor(x) {
  return `${normalizeText(x.organ)}|${normalizeText(x.expedient || x.title).slice(0, 160)}`;
}

async function buildSnapshot() {
  const [pubRaw, exeRaw, planRaw, awdRaw] = await Promise.all([
    safeFetch('pub', URLS.pub, {
      $limit: '1800',
      $order: ':updated_at DESC'
    }),
    safeFetch('exe', URLS.exe, {
      $limit: '800',
      $order: ':updated_at DESC'
    }),
    safeFetch('plan', URLS.plan, {
      $limit: '2500',
      $order: ':updated_at DESC'
    }),
    safeFetch('awd', URLS.awd, {
      $limit: '1500',
      $order: ':updated_at DESC'
    })
  ]);

  const pubs = pubRaw
    .map(normalizePub)
    .filter((x) => !x.date || x.date >= LAST_60_DAYS)
    .filter((x) => isTargetRecord(x.organ, x.scope));

  const exes = exeRaw
    .map(normalizeExe)
    .filter((x) => !x.date || x.date >= LAST_60_DAYS)
    .filter((x) => isTargetRecord(x.organ, x.scope));

  const plans = planRaw
    .map(normalizePlan)
    .filter((x) => {
      const anyValue = get(x.raw, ['any', 'Any']);
      return String(anyValue || '').includes('2026') || String(x.date || '').includes('2026');
    })
    .filter((x) => isTargetRecord(x.organ, x.scope));

  const awds = awdRaw
    .map(normalizeAwd)
    .filter((x) => !x.date || x.date >= LAST_365_DAYS)
    .filter((x) => isTargetRecord(x.organ, x.scope));

  const groups = new Map();

  for (const item of [...pubs, ...exes, ...plans]) {
    const key = keyFor(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const items = [];

  for (const entries of groups.values()) {
    entries.sort(
      (a, b) =>
        new Date(b.date || 0) - new Date(a.date || 0) ||
        statusPriority(b.status) - statusPriority(a.status)
    );

    const head = entries[0];
    const recentPubs = entries.filter((x) => x.source === 'pub' || x.source === 'exe');
    const signals = recentPubs.filter((x) => ['consulta', 'previ'].includes(x.status));
    const alertShorts = [...new Set(recentPubs.map((x) => x.short).filter(Boolean))];
    const signalLabels = [...new Set(signals.map((x) => x.short).filter(Boolean))];
    const alertUrl = recentPubs.find((x) => x.url)?.url || head.url || null;

    const planMatch =
      plans
        .map((p) => ({
          p,
          score:
            (normalizeText(p.organ) === normalizeText(head.organ) ? 0.25 : 0) +
            (head.cpv && p.cpv && String(head.cpv).slice(0, 4) === String(p.cpv).slice(0, 4)
              ? 0.2
              : 0) +
            Math.min(0.7, similarity(head.title, p.title))
        }))
        .filter((x) => x.score >= 0.45)
        .sort((a, b) => b.score - a.score)[0]?.p || null;

    const inc =
      awds
        .map((a) => ({
          a,
          score:
            (normalizeText(a.organ) === normalizeText(head.organ) ? 0.2 : 0) +
            (head.cpv && a.cpv && String(head.cpv).slice(0, 4) === String(a.cpv).slice(0, 4)
              ? 0.25
              : 0) +
            Math.min(0.65, similarity(head.title, a.title))
        }))
        .filter((x) => x.score >= 0.45)
        .sort((a, b) => b.score - a.score)[0]?.a || null;

    const item = {
      title: head.title,
      organ: head.organ,
      scope: head.scope,
      expedient: head.expedient,
      cpv: head.cpv,
      amount: head.amount,
      date: head.date,
      status: head.status,
      url: head.url,
      follow_url: head.url,
      priority: '',
      tags: [...new Set(entries.map((x) => x.status))],
      alerts: {
        count: recentPubs.length,
        latest_short: recentPubs[0]?.short || head.short,
        recent_short: alertShorts,
        url: alertUrl
      },
      signals: {
        count: signals.length,
        labels: signalLabels,
        url: signals[0]?.url || null
      },
      programmed: planMatch
        ? {
            matched: true,
            title: planMatch.title,
            amount: planMatch.amount,
            url: planMatch.url
          }
        : { matched: false },
      incumbent: inc
        ? {
            provider: inc.provider,
            discount_pct: inc.discount_pct,
            previous_contract: inc.expedient,
            url: inc.url,
            date: inc.date
          }
        : null
    };

    item.priority = priorityLabel(item);
    items.push(item);
  }

  items.sort(
    (a, b) => new Date(b.date || 0) - new Date(a.date || 0) || (b.amount || 0) - (a.amount || 0)
  );

  return {
    meta: {
      generated_at: ISO_NOW,
      snapshot_scope: 'Generalitat de Catalunya + focus CTTI',
      items: items.length,
      sources: [
        'PSCP publicacions',
        'PSCP execució',
        'Programació 2026',
        'Adjudicacions històriques'
      ]
    },
    items
  };
}

await fs.mkdir(DATA_DIR, { recursive: true });

let snapshot = null;

try {
  snapshot = await buildSnapshot();
} catch (err) {
  console.error('[FATAL] No s’ha pogut construir el snapshot:', err?.message || err);

  try {
    const current = await fs.readFile(OUT, 'utf8');
    snapshot = JSON.parse(current);
  } catch {
    snapshot = {
      meta: {
        generated_at: ISO_NOW,
        snapshot_scope: 'Generalitat de Catalunya + focus CTTI',
        items: 0,
        sources: [],
        warning: 'Snapshot buit per error de sincronització'
      },
      items: []
    };
  }
}

await fs.writeFile(OUT, JSON.stringify(snapshot, null, 2), 'utf8');
console.log(`snapshot escrit: ${OUT} (${snapshot.items.length} fitxes)`);
