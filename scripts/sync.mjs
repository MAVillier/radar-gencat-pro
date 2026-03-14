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

const NOW = new Date();
const ISO_NOW = NOW.toISOString();
const YEAR = '2026';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function n(v = '') {
  return String(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function get(o, keys) {
  for (const k of keys) {
    if (o?.[k] !== undefined && o?.[k] !== null && o?.[k] !== '') return o[k];
  }
  return null;
}

function findAny(o, regex) {
  for (const [k, v] of Object.entries(o || {})) {
    if (regex.test(k) && v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const x = Number(
    String(v)
      .replace(/\./g, '')
      .replace(/,/g, '.')
      .replace(/[^0-9.-]/g, '')
  );
  return Number.isFinite(x) ? x : null;
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

function is2026Date(v) {
  return String(v || '').startsWith('2026');
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
  const txt = n(
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
  const txt = n(
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

function orgProfileUrl(organ, scope = '') {
  const txt = n(`${organ} ${scope}`);

  if (txt.includes('centre de telecomunicacions') || txt.includes('ctti')) {
    return 'https://contractaciopublica.cat/ca/perfils-contractant/detall/ctti?categoria=0';
  }
  if (txt.includes("sistema d'emergencies mediques") || txt.includes('sistema d emergències mèdiques') || txt.includes('semsa') || txt.includes('(sem)')) {
    return 'https://contractaciopublica.cat/ca/perfils-contractant/detall/206778?categoria=0';
  }
  if (txt.includes('transports de barcelona')) {
    return 'https://contractaciopublica.cat/ca/perfils-contractant/detall/TB?categoria=0';
  }
  if (txt.includes('ferrocarril metropolita') || txt.includes('ferrocarril metropolità')) {
    return 'https://contractaciopublica.cat/en/perfils-contractant/detall/30109100?categoria=0';
  }
  if (txt.includes('tmb')) {
    return 'https://www.tmb.cat/es/negocios-y-empresas/perfil-contratante/licitaciones-y-adjudicaciones';
  }

  return null;
}

function inferUrl(o, organ, scope) {
  const direct =
    get(o, [
      'url_expedient',
      'url_publicacio',
      'url_publicaci',
      'enllac_expedient',
      'enllac',
      'link'
    ]) ||
    findAny(o, /(url|enllac|link)/i);

  if (direct) return direct;

  return orgProfileUrl(organ, scope);
}

function shouldKeep(organ, scope, dateValue, expedient) {
  const txt = n(`${organ} ${scope} ${expedient}`);

  // Tot 2026 + ens que t’interessen especialment / exemples que has citat
  if (String(expedient || '').startsWith('CTTI-2026-')) return true;
  if (String(expedient || '').startsWith('SEM-2026-')) return true;
  if (String(expedient || '').startsWith('2100')) return true; // TMB/FMB codis tipus 2100...
  if (String(expedient || '').startsWith('1200')) return true; // TMB/TB altres codis habituals
  if (txt.includes('ctti')) return true;
  if (txt.includes('(sem)') || txt.includes('semsa') || txt.includes("sistema d'emergencies mediques")) return true;
  if (txt.includes('transports de barcelona')) return true;
  if (txt.includes('ferrocarril metropolita') || txt.includes('ferrocarril metropolità')) return true;
  if (txt.includes('tmb')) return true;

  return is2026Date(dateValue);
}

function tokens(t) {
  return new Set(
    n(t)
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
  const txt = n(`${item.organ} ${item.scope} ${item.expedient}`);

  if (txt.includes('ctti')) score += 20;
  if (txt.includes('sem')) score += 15;
  if (txt.includes('tmb') || txt.includes('transports de barcelona') || txt.includes('ferrocarril metropolita')) score += 15;
  if (item.signals?.count) score += 15;
  if (item.incumbent?.provider) score += 15;
  if ((item.alerts?.count || 0) > 3) score += 10;
  if ((item.amount || 0) > 500000) score += 15;
  if (item.programmed?.matched) score += 10;

  if (score >= 65) return 'Oportunitat alta';
  if (score >= 40) return 'Seguiment prioritari';
  return 'Seguiment';
}

async function fetchJsonWithRetry(url, params = {}, options = {}) {
  const { retries = 5, timeoutMs = 30000, baseDelayMs = 1500 } = options;
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

      if (!retriable || attempt === retries) throw lastError;
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
  const organ = inferOrgan(o);
  const scope = inferScope(o);
  return {
    source: 'pub',
    status: inferStatus(o),
    title: inferTitle(o),
    organ,
    scope,
    expedient: inferExpedient(o),
    cpv: inferCPV(o),
    amount: num(inferAmount(o)),
    date: inferDate(o),
    url: inferUrl(o, organ, scope),
    short: inferAlertShort(o),
    raw: o
  };
}

function normalizeExe(o) {
  const organ = inferOrgan(o);
  const scope = inferScope(o);
  return {
    source: 'exe',
    status: 'execucio',
    title: inferTitle(o),
    organ,
    scope,
    expedient: inferExpedient(o),
    cpv: inferCPV(o),
    amount: num(inferAmount(o)),
    date: inferDate(o),
    url: inferUrl(o, organ, scope),
    short: 'En execució',
    raw: o
  };
}

function normalizePlan(o) {
  const organ = inferOrgan(o);
  const scope = inferScope(o);
  return {
    source: 'plan',
    status: 'programada',
    title: inferTitle(o),
    organ,
    scope,
    expedient: inferExpedient(o),
    cpv: inferCPV(o),
    amount: num(inferAmount(o)),
    date: inferDate(o) || '2026-01-01T00:00:00Z',
    url: inferUrl(o, organ, scope),
    short: 'Programació 2026',
    raw: o
  };
}

function normalizeAwd(o) {
  const organ = inferOrgan(o);
  const scope = inferScope(o);
  const licitat = num(get(o, ['import_licitat', 'import_licitacio']));
  const adjudicat = num(get(o, ['import_adjudicat_sense_iva', 'import_adjudicat']));
  return {
    source: 'awd',
    title: inferTitle(o),
    organ,
    scope,
    expedient: inferExpedient(o),
    cpv: inferCPV(o),
    licitat,
    adjudicat,
    provider: get(o, ['empresa_adjudicat_ria', 'empresa_adjudicataria', 'adjudicatari']) || '',
    date: inferDate(o),
    url: inferUrl(o, organ, scope),
    discount_pct: licitat && adjudicat && licitat > 0 ? ((licitat - adjudicat) / licitat) * 100 : null,
    raw: o
  };
}

function keyFor(x) {
  return `${n(x.organ)}|${n(x.expedient || x.title).slice(0, 180)}`;
}

async function buildSnapshot() {
  // 2026 only, but broad enough to catch CTTI / SEM / TMB / FMB and the rest
  const [pubRaw, exeRaw, planRaw, awdRaw] = await Promise.all([
    safeFetch('pub', URLS.pub, {
      $limit: '10000',
      $order: ':updated_at DESC'
    }),
    safeFetch('exe', URLS.exe, {
      $limit: '6000',
      $order: ':updated_at DESC'
    }),
    safeFetch('plan', URLS.plan, {
      $limit: '4000',
      $where: `(any = 2026 OR any = '2026')`,
      $order: ':updated_at DESC'
    }),
    safeFetch('awd', URLS.awd, {
      $limit: '4000',
      $where: `(any = 2026 OR any = '2026')`,
      $order: ':updated_at DESC'
    })
  ]);

  const pubs = pubRaw
    .map(normalizePub)
    .filter((x) => shouldKeep(x.organ, x.scope, x.date, x.expedient))
    .filter((x) => is2026Date(x.date) || String(x.expedient || '').includes('2026'));

  const exes = exeRaw
    .map(normalizeExe)
    .filter((x) => shouldKeep(x.organ, x.scope, x.date, x.expedient))
    .filter((x) => is2026Date(x.date) || String(x.expedient || '').includes('2026'));

  const plans = planRaw
    .map(normalizePlan)
    .filter((x) => shouldKeep(x.organ, x.scope, x.date, x.expedient));

  const awds = awdRaw
    .map(normalizeAwd)
    .filter((x) => shouldKeep(x.organ, x.scope, x.date, x.expedient));

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

    const fallbackLink =
      head.url ||
      recentPubs.find((x) => x.url)?.url ||
      orgProfileUrl(head.organ, head.scope);

    const planMatch =
      plans
        .map((p) => ({
          p,
          score:
            (n(p.organ) === n(head.organ) ? 0.25 : 0) +
            (head.cpv && p.cpv && String(head.cpv).slice(0, 4) === String(p.cpv).slice(0, 4) ? 0.2 : 0) +
            Math.min(0.7, similarity(head.title, p.title))
        }))
        .filter((x) => x.score >= 0.45)
        .sort((a, b) => b.score - a.score)[0]?.p || null;

    const inc =
      awds
        .map((a) => ({
          a,
          score:
            (n(a.organ) === n(head.organ) ? 0.2 : 0) +
            (head.cpv && a.cpv && String(head.cpv).slice(0, 4) === String(a.cpv).slice(0, 4) ? 0.25 : 0) +
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
      url: fallbackLink,
      follow_url: fallbackLink,
      priority: '',
      tags: [...new Set(entries.map((x) => x.status))],
      alerts: {
        count: recentPubs.length,
        latest_short: recentPubs[0]?.short || head.short,
        recent_short: alertShorts,
        url: recentPubs.find((x) => x.url)?.url || fallbackLink
      },
      signals: {
        count: signals.length,
        labels: signalLabels,
        url: signals.find((x) => x.url)?.url || fallbackLink
      },
      programmed: planMatch
        ? {
            matched: true,
            title: planMatch.title,
            amount: planMatch.amount,
            url: planMatch.url || fallbackLink
          }
        : { matched: false },
      incumbent: inc
        ? {
            provider: inc.provider,
            discount_pct: inc.discount_pct,
            previous_contract: inc.expedient,
            url: inc.url || fallbackLink,
            date: inc.date
          }
        : null
    };

    item.priority = priorityLabel(item);
    items.push(item);
  }

  items.sort(
    (a, b) =>
      new Date(b.date || 0) - new Date(a.date || 0) ||
      (b.amount || 0) - (a.amount || 0)
  );

  return {
    meta: {
      generated_at: ISO_NOW,
      snapshot_scope: 'Tot 2026 · PSCP · CTTI + SEM + TMB/FMB + resta',
      items: items.length,
      sources: [
        'PSCP publicacions',
        'PSCP execució',
        'Programació 2026',
        'Adjudicacions històriques 2026'
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
        snapshot_scope: 'Tot 2026 · PSCP',
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
