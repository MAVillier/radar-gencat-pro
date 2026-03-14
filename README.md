# Radar Gencat Pro

App estàtica amb disseny mòbil-first per seguir licitacions de la Generalitat de Catalunya amb focus CTTI.

## Què fa
- Mostra licitacions en format fitxa
- Filtra per CTTI / Generalitat / tot el snapshot
- Afegeix senyals (consulta mercat i anunci previ)
- Fa matching amb programació 2026
- Estima incumbent i baixa històrica
- Mostra mòdul d'avisos: comptador, resum curt del darrer avís i enllaç
- Es refresca cada hora via GitHub Actions

## Arquitectura
- Frontend estàtic: `index.html`, `styles.css`, `app.js`
- Dades precomputades: `data/snapshot.json`
- Script d'enriquiment: `scripts/sync.mjs`
- Sync horari: `.github/workflows/hourly-sync.yml`
- Deploy: Vercel (importat des de GitHub)

## Deploy ràpid
1. Crea un repositori a GitHub
2. Puja tots aquests fitxers
3. Importa el repo a Vercel
4. El workflow de GitHub anirà regenerant `data/snapshot.json` cada hora
5. Cada nou commit farà redeploy automàtic a Vercel

## Nota
El matching d'incumbent i programació és heurístic. El resultat és útil comercialment, però convé validar manualment les coincidències més importants.
