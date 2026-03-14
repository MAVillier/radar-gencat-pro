
const state = { data: null, rows: [] };
const $ = (s) => document.querySelector(s);

function n(v=''){ return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function money(v){ const x = Number(v); return Number.isFinite(x) ? new Intl.NumberFormat('ca-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(x) : '—'; }
function datef(v){ if(!v) return '—'; const d = new Date(v); return Number.isNaN(d) ? v : new Intl.DateTimeFormat('ca-ES',{dateStyle:'medium', timeStyle: 'short'}).format(d); }
function shortDate(v){ if(!v) return '—'; const d = new Date(v); return Number.isNaN(d) ? v : new Intl.DateTimeFormat('ca-ES',{dateStyle:'medium'}).format(d); }
function esc(s=''){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
function statusLabel(k){ return {licitacio:'Licitació',avaluacio:'Avaluació',adjudicacio:'Adjudicació',formalitzacio:'Formalització',execucio:'Execució',previ:'Anunci previ',consulta:'Consulta mercat',programada:'Programada 2026'}[k] || k; }
function scopeMatch(r, scope){ const txt = `${r.organ} ${r.scope} ${r.tags?.join(' ')}`; if(scope === 'ctti') return /ctti|centre de telecomunicacions/i.test(txt); if(scope === 'generalitat') return /generalitat|departament|institut catal|servei catal|agencia|agència|ferrocarrils|infraestructures/i.test(txt); return true; }
function daysPass(r, days){ if(r.status === 'programada') return true; if(!r.date) return true; const d = new Date(r.date).getTime(); return d >= Date.now() - days*24*60*60*1000; }
function textMatch(r, q){ if(!q) return true; const hay = n([r.title,r.organ,r.scope,r.expedient,r.cpv,r.incumbent?.provider,r.alerts?.latest_short,...(r.tags||[])].join(' | ')); return hay.includes(q); }

async function load(){
  $('#loading').classList.remove('hidden');
  $('#error').classList.add('hidden');
  $('#grid').classList.add('hidden');
  $('#empty').classList.add('hidden');
  try {
    const res = await fetch('data/snapshot.json?ts=' + Date.now());
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.rows = Array.isArray(state.data.items) ? state.data.items : [];
    renderMeta();
    render();
  } catch(err) {
    $('#error').innerHTML = `<strong>No s'ha pogut carregar el snapshot.</strong><br>${esc(err.message)}`;
    $('#error').classList.remove('hidden');
  } finally {
    $('#loading').classList.add('hidden');
  }
}

function renderMeta(){
  const md = state.data?.meta || {};
  $('#statSync').textContent = md.generated_at ? shortDate(md.generated_at) : '—';
  const banner = $('#metaBanner');
  banner.innerHTML = `Snapshot ${md.snapshot_scope || '—'} · ${md.items || 0} fitxes · fonts: ${(md.sources||[]).join(', ')}`;
  banner.classList.remove('hidden');
}

function render(){
  const scope = $('#scope').value;
  const status = $('#status').value;
  const q = n($('#q').value || '');
  const days = Number($('#days').value || '60');
  const onlySignals = $('#onlySignals').checked;
  const onlyInc = $('#onlyInc').checked;
  let rows = state.rows
    .filter(r => scopeMatch(r, scope))
    .filter(r => daysPass(r, days))
    .filter(r => status === 'all' ? true : r.status === status)
    .filter(r => textMatch(r, q))
    .filter(r => onlySignals ? (r.signals?.count || 0) > 0 : true)
    .filter(r => onlyInc ? !!r.incumbent?.provider : true)
    .sort((a,b)=> new Date(b.date||0) - new Date(a.date||0));

  $('#statTotal').textContent = rows.length;
  $('#statCtti').textContent = rows.filter(r => /ctti|centre de telecomunicacions/i.test(`${r.organ} ${r.scope}`)).length;
  $('#statInc').textContent = rows.filter(r => !!r.incumbent?.provider).length;

  const grid = $('#grid');
  grid.innerHTML = '';
  if(!rows.length){
    $('#grid').classList.add('hidden');
    $('#empty').classList.remove('hidden');
    return;
  }
  $('#grid').classList.remove('hidden');
  $('#empty').classList.add('hidden');

  rows.forEach(r => grid.appendChild(card(r)));
}

function card(r){
  const el = document.createElement('article');
  el.className = 'card';
  const alertShorts = (r.alerts?.recent_short || []).slice(0,3).map(x => `<span>${esc(x)}</span>`).join('');
  const signalText = (r.signals?.count || 0) > 0
    ? `${r.signals.count} senyal(s): ${esc((r.signals?.labels || []).join(' · '))}`
    : 'Sense senyals prèvies detectades';
  const incText = r.incumbent?.provider
    ? `${esc(r.incumbent.provider)} · ${r.incumbent.discount_pct != null ? `${r.incumbent.discount_pct.toFixed(1)}% de baixa` : 'baixa no disponible'} · ${r.incumbent.previous_contract ? esc(r.incumbent.previous_contract) : 'sense expedient anterior'}`
    : 'Sense incumbent fiable detectat';
  const planText = r.programmed?.matched
    ? `${esc(r.programmed?.title || 'Coincidència amb programació 2026')} ${r.programmed?.amount ? '· ' + money(r.programmed.amount) : ''}`
    : 'Sense match clar amb programació 2026';
  const noticesUrl = r.alerts?.url || r.url || '#';
  const followUrl = r.follow_url || r.url || '#';
  el.innerHTML = `
    <div class='row'>
      <div class='badges'>
        <span class='badge b-status'>${statusLabel(r.status)}</span>
        ${/ctti|centre de telecomunicacions/i.test(`${r.organ} ${r.scope}`) ? `<span class='badge b-ctti'>CTTI</span>` : ''}
        ${(r.signals?.count || 0) > 0 ? `<span class='badge b-signal'>Senyals</span>` : ''}
        ${r.incumbent?.provider ? `<span class='badge b-inc'>Incumbent</span>` : ''}
        ${(r.alerts?.count || 0) > 1 ? `<span class='badge b-av'>Avisos</span>` : ''}
      </div>
      <div class='score'>${esc(r.priority || 'Seguiment')}</div>
    </div>

    <div>
      <h3 class='title'>${esc(r.title)}</h3>
      <p class='sub'>${esc(r.organ)} · ${esc(r.expedient || 'sense expedient')}</p>
    </div>

    <div class='meta'>
      <div class='kv'><span>Data</span><strong>${shortDate(r.date)}</strong></div>
      <div class='kv'><span>Import</span><strong>${money(r.amount)}</strong></div>
      <div class='kv'><span>CPV</span><strong>${esc(r.cpv || '—')}</strong></div>
      <div class='kv'><span>Àmbit</span><strong>${esc(r.scope || '—')}</strong></div>
    </div>

    <div class='bl bl--alert'>
      <div class='alert-line'>
        <div>
          <strong>Avisos</strong>
          <p>Darrer avís: <b>${esc(r.alerts?.latest_short || 'Sense resum')}</b></p>
        </div>
        <div class='alert-count'>${r.alerts?.count || 0}</div>
      </div>
      <div class='alert-mini'>${alertShorts || '<span>Sense més avisos</span>'}</div>
    </div>

    <div class='bl bl--signal'><strong>Senyals</strong><p>${signalText}</p></div>
    <div class='bl bl--plan'><strong>Programació 2026</strong><p>${planText}</p></div>
    <div class='bl bl--inc'><strong>Incumbent</strong><p>${incText}</p></div>

    <div class='actions'>
      ${r.url ? `<a href='${r.url}' target='_blank' rel='noopener'>Obrir expedient</a>` : ''}
      <a href='${noticesUrl}' target='_blank' rel='noopener'>Veure avisos</a>
      <a href='${followUrl}' target='_blank' rel='noopener'>Seguir</a>
    </div>`;
  return el;
}

['#q','#status','#days','#onlySignals','#onlyInc','#scope'].forEach(sel => {
  const ev = sel === '#scope' || sel === '#days' ? 'change' : 'input';
  $(sel).addEventListener(ev, render);
});
$('#reloadBtn').addEventListener('click', load);
load();
