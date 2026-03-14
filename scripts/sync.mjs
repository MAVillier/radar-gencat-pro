
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

const today = new Date();
const iso = today.toISOString();
const last60 = new Date(today.getTime() - 60*24*60*60*1000).toISOString();
const last365 = new Date(today.getTime() - 365*24*60*60*1000).toISOString();

function n(v=''){ return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function num(v){ if(v == null || v === '') return null; const x = Number(String(v).replace(/\./g,'').replace(/,/g,'.').replace(/[^0-9.-]/g,'')); return Number.isFinite(x) ? x : null; }
function get(o, keys){ for(const k of keys){ if(o?.[k] != null && o[k] !== '') return o[k]; } return null; }
function findAny(o, regex){ const entry = Object.entries(o).find(([k,v]) => regex.test(k) && v != null && v !== ''); return entry ? entry[1] : null; }
function inferDate(o){ return get(o,['data_publicacio','data_publicacio_anunci','data_publicaci','data_d_adjudicacio','data_adjudicacio','data_formalitzacio','data_inici','data_prevista']) || findAny(o,/^data_/i) || null; }
function inferUrl(o){ return get(o,['url_expedient','url_publicacio','url_publicaci','enllac_expedient','enllac','link']) || findAny(o,/(url|enllac|link)/i) || null; }
function inferTitle(o){ return get(o,['descripcio_contracte','descripci_del_contracte','descripcio_del_contracte','objecte_contracte','objecte_del_lot','titol','descripcio']) || 'Sense títol'; }
function inferOrgan(o){ return get(o,['nom_organ','organ_de_contractaci','orga_de_contractaci','organ']) || 'Sense organisme'; }
function inferScope(o){ return get(o,['nom_ambit','ambit','departament','nom_departament','departament_d_adscripci','departament_d_adscripcio','nom_departament_ens']) || ''; }
function inferExp(o){ return get(o,['codi_expedient','codi_d_expedient','expedient']) || ''; }
function inferCPV(o){ return get(o,['codi_cpv','cpv','cpv_principal']) || ''; }
function inferAmount(o){ return get(o,['import_licitacio','import_de_licitacio','import_licitat','valor_estimat_contracte','pressupost_base_licitacio','import_previst_sense_iva','import_previst','import_adjudicat_sense_iva','import_adjudicat','import']) || null; }

function inferStatus(o){
  const txt = n(Object.entries(o).filter(([k]) => /(tipus|fase|publicaci|estat|anunci)/i.test(k)).map(([,v]) => String(v)).join(' | '));
  if(txt.includes('consulta preliminar')) return 'consulta';
  if(txt.includes('anunci previ')) return 'previ';
  if(txt.includes('execuc')) return 'execucio';
  if(txt.includes('formalitz')) return 'formalitzacio';
  if(txt.includes('adjudic')) return 'adjudicacio';
  if(txt.includes('avalu')) return 'avaluacio';
  if(txt.includes('licit')) return 'licitacio';
  return 'licitacio';
}

function inferAlertShort(o){
  const txt = n(Object.entries(o).filter(([k]) => /(tipus|fase|publicaci|estat|anunci|titol|descripcio)/i.test(k)).map(([,v]) => String(v)).join(' | '));
  if(txt.includes('rectif') || txt.includes('esmena')) return 'Plecs rectificats';
  if(txt.includes('ampli')) return 'Termini ampliat';
  if(txt.includes('dubte') || txt.includes('pregunt')) return 'Dubtes resolts';
  if(txt.includes('adjudic')) return 'Adjudicació publicada';
  if(txt.includes('formalitz')) return 'Contracte formalitzat';
  if(txt.includes('avalu')) return 'En avaluació';
  if(txt.includes('consulta preliminar')) return 'Consulta mercat';
  if(txt.includes('anunci previ')) return 'Anunci previ';
  if(txt.includes('execuc')) return 'En execució';
  if(txt.includes('licit')) return 'Licitació oberta';
  return 'Actualització expedient';
}

function tokens(t){ return new Set(n(t).replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(x => x.length > 2 && !['dels','deles','dela','de','la','el','les','del','amb','per','servei','serveis','contracte','contractes','subministrament','suport','oficina','tecnica','tècnica'].includes(x))); }
function sim(a,b){ const A = tokens(a), B = tokens(b); if(!A.size || !B.size) return 0; let same = 0; for(const x of A) if(B.has(x)) same++; return same / Math.max(4, Math.min(A.size, B.size)); }
function statusPriority(s){ return ({licitacio:8, avaluacio:7, adjudicacio:6, formalitzacio:5, execucio:4, consulta:3, previ:2, programada:1})[s] || 0; }
function priorityLabel(item){
  let score = 0;
  if(/ctti|centre de telecomunicacions/i.test(`${item.organ} ${item.scope}`)) score += 25;
  if(item.signals?.count) score += 20;
  if(item.incumbent?.provider) score += 20;
  if(item.alerts?.count > 3) score += 10;
  if((item.amount || 0) > 1000000) score += 15;
  if(item.programmed?.matched) score += 10;
  if(score >= 70) return 'Oportunitat alta';
  if(score >= 45) return 'Seguiment prioritari';
  return 'Seguiment';
}

async function fetchJson(url, params){
  const qs = new URLSearchParams(params);
  const full = `${url}?${qs}`;
  const res = await fetch(full, { headers: { 'accept': 'application/json' } });
  if(!res.ok) throw new Error(`${res.status} ${res.statusText} -> ${full}`);
  return await res.json();
}

function normalizePub(o){
  return {
    source: 'pub',
    status: inferStatus(o),
    title: inferTitle(o),
    organ: inferOrgan(o),
    scope: inferScope(o),
    expedient: inferExp(o),
    cpv: inferCPV(o),
    amount: num(inferAmount(o)),
    date: inferDate(o),
    url: inferUrl(o),
    short: inferAlertShort(o),
    raw: o
  };
}
function normalizeExe(o){
  return {
    source: 'exe',
    status: 'execucio',
    title: inferTitle(o),
    organ: inferOrgan(o),
    scope: inferScope(o),
    expedient: inferExp(o),
    cpv: inferCPV(o),
    amount: num(inferAmount(o)),
    date: inferDate(o),
    url: inferUrl(o),
    short: 'En execució',
    raw: o
  };
}
function normalizePlan(o){
  return {
    source: 'plan',
    status: 'programada',
    title: inferTitle(o),
    organ: inferOrgan(o),
    scope: inferScope(o),
    expedient: inferExp(o),
    cpv: inferCPV(o),
    amount: num(inferAmount(o)),
    date: inferDate(o) || '2026-01-01T00:00:00Z',
    url: inferUrl(o),
    short: 'Programació 2026',
    raw: o
  };
}
function normalizeAwd(o){
  const licitat = num(get(o,['import_licitat','import_licitacio']));
  const adjudicat = num(get(o,['import_adjudicat_sense_iva','import_adjudicat']));
  return {
    source: 'awd',
    title: inferTitle(o),
    organ: inferOrgan(o),
    scope: inferScope(o),
    expedient: inferExp(o),
    cpv: inferCPV(o),
    licitat,
    adjudicat,
    provider: get(o,['empresa_adjudicat_ria','empresa_adjudicataria','adjudicatari']) || '',
    date: inferDate(o),
    url: inferUrl(o),
    discount_pct: licitat && adjudicat && licitat > 0 ? ((licitat - adjudicat)/licitat)*100 : null,
    raw: o
  };
}

function keyFor(x){ return `${n(x.organ)}|${n(x.expedient || x.title).slice(0,140)}`; }

async function build(){
  const pubWhere = `(lower(nom_ambit) like '%generalitat de catalunya%' OR lower(nom_organ) like '%centre de telecomunicacions i tecnologies de la informaci%')`;
  const exeWhere = pubWhere;
  const planWhere = `(any = 2026 OR any = '2026') AND (lower(nom_departament_ens) like '%generalitat%' OR lower(orga_de_contractaci) like '%ctti%' OR lower(organ_de_contractaci) like '%ctti%')`;
  const awdWhere = null;

  const [pub, exe, plan, awd] = await Promise.all([
    fetchJson(URLS.pub, {'$limit':'4000','$order':':updated_at DESC','$where': pubWhere}),
    fetchJson(URLS.exe, {'$limit':'1500','$order':':updated_at DESC','$where': exeWhere}),
    fetchJson(URLS.plan, {'$limit':'3000','$order':':updated_at DESC','$where': planWhere}),
    fetchJson(URLS.awd, {'$limit':'3000','$order':':updated_at DESC'})
  ]);

  const pubs = pub.map(normalizePub).filter(x => !x.date || x.date >= last60);
  const exes = exe.map(normalizeExe).filter(x => !x.date || x.date >= last60);
  const plans = plan.map(normalizePlan);
  const awds = awd.map(normalizeAwd).filter(x => !x.date || x.date >= last365);

  const groups = new Map();
  for(const item of pubs){
    const key = keyFor(item);
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for(const item of exes){
    const key = keyFor(item);
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for(const item of plans){
    const key = keyFor(item);
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const items = [];
  for(const entries of groups.values()){
    entries.sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0) || statusPriority(b.status) - statusPriority(a.status));
    const head = entries[0];
    const recentPubs = entries.filter(x => x.source === 'pub' || x.source === 'exe');
    const alertShorts = [...new Set(recentPubs.map(x => x.short).filter(Boolean))];
    const alertUrl = recentPubs.find(x => x.url)?.url || head.url || null;
    const signals = recentPubs.filter(x => ['consulta','previ'].includes(x.status));
    const signalLabels = [...new Set(signals.map(x => x.short))];

    const planMatch = plans
      .map(p => ({ p, score: (n(p.organ) === n(head.organ) ? 0.25 : 0) + (head.cpv && p.cpv && String(head.cpv).slice(0,4) === String(p.cpv).slice(0,4) ? 0.2 : 0) + Math.min(0.7, sim(head.title, p.title)) }))
      .filter(x => x.score >= 0.45)
      .sort((a,b)=>b.score-a.score)[0]?.p || null;

    const inc = awds
      .map(a => ({ a, score: (n(a.organ) === n(head.organ) ? 0.2 : 0) + (head.cpv && a.cpv && String(head.cpv).slice(0,4) === String(a.cpv).slice(0,4) ? 0.25 : 0) + Math.min(0.65, sim(head.title, a.title)) }))
      .filter(x => x.score >= 0.45)
      .sort((a,b)=>b.score-a.score)[0]?.a || null;

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
      tags: [...new Set(entries.map(x => x.status))],
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
      programmed: planMatch ? {
        matched: true,
        title: planMatch.title,
        amount: planMatch.amount,
        url: planMatch.url
      } : { matched: false },
      incumbent: inc ? {
        provider: inc.provider,
        discount_pct: inc.discount_pct,
        previous_contract: inc.expedient,
        url: inc.url,
        date: inc.date
      } : null
    };
    item.priority = priorityLabel(item);
    items.push(item);
  }

  items.sort((a,b)=> new Date(b.date || 0) - new Date(a.date || 0) || (b.amount || 0) - (a.amount || 0));
  return {
    meta: {
      generated_at: iso,
      snapshot_scope: 'Generalitat de Catalunya + focus CTTI',
      items: items.length,
      sources: ['PSCP publicacions','PSCP execució','Programació 2026','Adjudicacions històriques']
    },
    items
  };
}

const data = await build();
await fs.mkdir(DATA_DIR, { recursive: true });
await fs.writeFile(OUT, JSON.stringify(data, null, 2));
console.log(`snapshot escrit: ${OUT} (${data.items.length} fitxes)`);
