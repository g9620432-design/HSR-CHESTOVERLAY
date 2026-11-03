// Сборка пакета данных «Персонажи и реликвии» для HSR Chest Overlay.
// node build.mjs --src <hsr-optimizer> --out <папка> [--key <ed25519 private pem>] [--app-release app-release.json]
// Источник расчётов и метаданных: HSR Optimizer (MIT License, (c) Fribbels) — https://github.com/fribbels/hsr-optimizer
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return a; }, []));
const SRC = path.resolve(args.src || '/data/ext/hsr-optimizer');
const OUT = path.resolve(args.out || path.join(HERE, 'out'));
const req = createRequire(path.join(SRC, 'package.json'));
const yaml = req('js-yaml');
let sharp = null;
for (const t of [process.env.HSRPACK_SHARP, 'sharp']) { if (!t || sharp) continue; try { sharp = t === 'sharp' ? req('sharp') : createRequire(import.meta.url)(t); } catch { /* следующий */ } }
if (!sharp) console.warn('[hsrpack] sharp not found — icons copied without resizing');

const log = (...a) => console.log('[hsrpack]', ...a);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });

// 1) движок
log('engine…');
execFileSync('bash', [path.join(HERE, 'build-engine.sh'), SRC, path.join(OUT, '.eng')], { stdio: 'inherit' });
fs.renameSync(path.join(OUT, '.eng', 'engine.mjs'), path.join(OUT, 'engine.mjs'));
fs.rmSync(path.join(OUT, '.eng'), { recursive: true, force: true });
const E = await import(pathToFileURL(path.join(OUT, 'engine.mjs')).href + '?t=' + Date.now());
E.init();
const M = E.rawMeta();
const DLC = E.defaultLightCones();
let commit = ''; try { commit = execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD']).toString().trim(); } catch { /* */ }

// 2) локализация
const L = {};
for (const [k, d] of [['ru', 'ru_RU'], ['en', 'en_US']]) {
  L[k] = { g: yaml.load(fs.readFileSync(path.join(SRC, 'public/locales', d, 'gameData.yaml'), 'utf8')), c: yaml.load(fs.readFileSync(path.join(SRC, 'public/locales', d, 'common.yaml'), 'utf8')) };
}
const clean = (s) => String(s || '').replace(/⚰️\s*/gu, '').trim();
const ELKEY = { Physical: 'Physical', Fire: 'Fire', Ice: 'Ice', Lightning: 'Thunder', Thunder: 'Thunder', Wind: 'Wind', Quantum: 'Quantum', Imaginary: 'Imaginary' };
const PATHKEY = { Destruction: 'Warrior', Hunt: 'Rogue', Erudition: 'Mage', Harmony: 'Shaman', Nihility: 'Warlock', Preservation: 'Knight', Abundance: 'Priest', Remembrance: 'Memory', Elation: 'Elation' };
const resolveT = (s, lang) => String(s || '').replace(/\$t\(gameData:Elements\.(\w+)\)/g, (_, e) => L[lang].g.Elements[e] || e);
const i18n = { stats: {}, paths: {}, elements: {} };
for (const k of Object.keys(L.en.c.Stats)) i18n.stats[k] = { ru: resolveT(L.ru.c.Stats[k], 'ru'), en: resolveT(L.en.c.Stats[k], 'en'), sru: resolveT(L.ru.c.ShortStats?.[k] || L.ru.c.Stats[k], 'ru'), sen: resolveT(L.en.c.ShortStats?.[k] || L.en.c.Stats[k], 'en') };
// русская грамматика и привычные игрокам сокращения (в исходной локали — «Бонус Огненный урона»)
const RU_FIX = {
  'CRIT Rate': ['Крит. шанс', 'КШ'], 'CRIT DMG': ['Крит. урон', 'КУ'], 'SPD%': ['Скорость %', 'СКР%'],
  'Energy Regeneration Rate': ['Восст. энергии', 'ВЭ'], 'Effect RES': ['Сопр. эффектам', 'СОПР'], 'Effect Hit Rate': ['Шанс эффектов', 'ШПЭ'], 'Break Effect': ['Эффект пробития', 'ЭП'],
  'Physical DMG Boost': ['Бонус физического урона', 'Физ. урон'], 'Fire DMG Boost': ['Бонус огненного урона', 'Огн. урон'], 'Ice DMG Boost': ['Бонус ледяного урона', 'Лед. урон'],
  'Lightning DMG Boost': ['Бонус электрического урона', 'Элек. урон'], 'Wind DMG Boost': ['Бонус ветряного урона', 'Вет. урон'], 'Quantum DMG Boost': ['Бонус квантового урона', 'Квант. урон'], 'Imaginary DMG Boost': ['Бонус мнимого урона', 'Мним. урон'],
};
for (const [k, [full, short]] of Object.entries(RU_FIX)) if (i18n.stats[k]) { i18n.stats[k].ru = full; i18n.stats[k].sru = short; }
for (const [p, k] of Object.entries(PATHKEY)) i18n.paths[p] = { ru: L.ru.g.Paths[k] || p, en: L.en.g.Paths[k] || p };
for (const [e, k] of Object.entries(ELKEY)) if (e !== 'Thunder') i18n.elements[e] = { ru: L.ru.g.Elements[k] || e, en: L.en.g.Elements[k] || e };

// 3) персонажи
const chars = {};
const kinds = { simulation: 'dps', supportSimulation: 'buffer', healSimulation: 'heal', shieldSimulation: 'shield' };
for (const [id, c] of Object.entries(M.characters)) {
  const sm = c.scoringMetadata || {};
  const sim = sm.simulation || sm.supportSimulation || sm.healSimulation || sm.shieldSimulation || null;
  const lr = L.ru.g.Characters[id] || {}, le = L.en.g.Characters[id] || {};
  const pre = !!(M.characters[id + 'b1'] && !M.characters[id + 'b1'].unreleased);
  const teams = [];
  for (const s of Object.keys(kinds).map((k) => sm[k]).filter(Boolean)) {
    for (const t of (s.leaderboardTeams || [])) teams.push(t.teammates.map((m) => ({ c: m.characterId, lc: (m.lightCones || [])[0] })));
  }
  const uniqTeams = []; const seen = new Set();
  const main = sim ? sim.teammates.map((m) => ({ c: m.characterId, lc: m.lightCone, e: m.characterEidolon, s: m.lightConeSuperimposition })) : [];
  for (const t of [main, ...teams]) { const k = t.map((m) => m.c).sort().join(','); if (t.length && !seen.has(k)) { seen.add(k); uniqTeams.push(t); } }
  chars[id] = {
    n: { ru: clean(lr.Name || c.name), en: clean(le.Name || c.name) },
    ln: { ru: clean(lr.LongName || lr.Name || c.name), en: clean(le.LongName || le.Name || c.name) },
    r: c.rarity, p: c.path, e: c.element, sp: c.max_sp,
    old: pre || undefined, un: c.unreleased || undefined,
    base: c.stats, lc: DLC[id] || null,
    w: sm.stats || {}, mains: sm.parts || {},
    subs: sim ? sim.substats : [], sets: sim ? sim.relicSets : [], orn: sim ? [...new Set(sim.ornamentSets)] : [],
    simMains: sim ? sim.parts : {},
    teams: uniqTeams.slice(0, 6),
    kinds: Object.entries(kinds).filter(([k]) => sm[k]).map(([, v]) => v),
  };
}

// 4) световые конусы и комплекты
const lcs = {};
for (const [id, c] of Object.entries(M.lightCones)) {
  const lr = L.ru.g.Lightcones[id] || {}, le = L.en.g.Lightcones[id] || {};
  lcs[id] = { n: { ru: clean(lr.Name || c.name), en: clean(le.Name || c.name) }, r: c.rarity, p: c.path, base: c.stats, un: c.unreleased || undefined };
}
const sets = {};
for (const [id, s] of Object.entries(M.relics.relicSets)) {
  const lr = L.ru.g.RelicSets[id] || {}, le = L.en.g.RelicSets[id] || {};
  sets[id] = { key: s.name, n: { ru: clean(lr.Name || s.name), en: clean(le.Name || s.name) }, d2: { ru: lr.Description2pc || '', en: le.Description2pc || '' }, d4: lr.Description4pc || le.Description4pc ? { ru: lr.Description4pc || '', en: le.Description4pc || '' } : undefined, orn: Number(id) >= 300 };
}

// 5) иконки
async function img(src, dst, size) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (sharp) await sharp(src).resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(dst);
  else fs.copyFileSync(src, dst);
  return true;
}
const A = path.join(SRC, 'public/assets/icon');
let nimg = 0;
for (const id of Object.keys(chars)) nimg += await img(path.join(A, 'avatar', id + '.webp'), path.join(OUT, 'img/c', id + '.webp'), 128) ? 1 : 0;
for (const id of Object.keys(lcs)) nimg += await img(path.join(A, 'light_cone', id + '.webp'), path.join(OUT, 'img/lc', id + '.webp'), 128) ? 1 : 0;
for (const id of Object.keys(sets)) nimg += await img(path.join(A, 'relic', id + '.webp'), path.join(OUT, 'img/set', id + '.webp'), 96) ? 1 : 0;
for (const pn of ['Head', 'Hands', 'Body', 'Feet', 'PlanarSphere', 'LinkRope']) nimg += await img(path.join(SRC, 'public/assets/misc', 'part' + pn + '.webp'), path.join(OUT, 'img/part', pn + '.webp'), 48) ? 1 : 0;
for (const d of ['path', 'element', 'property']) for (const f of fs.existsSync(path.join(A, d)) ? fs.readdirSync(path.join(A, d)) : []) nimg += await img(path.join(A, d, f), path.join(OUT, 'img', d, f), 64) ? 1 : 0;
log('images', nimg);

// 6) meta.json + манифест + подпись
const body = { chars, lcs, sets, i18n };
const hash = crypto.createHash('sha256').update(JSON.stringify(body)).update(fs.readFileSync(path.join(OUT, 'engine.mjs'))).digest('hex').slice(0, 10);
const d = new Date();
const version = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}-${hash}`;
const meta = { format: 1, version, bridge: E.BRIDGE_VERSION, source: { name: 'HSR Optimizer', license: 'MIT', commit }, ...body };
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
fs.writeFileSync(path.join(OUT, 'LICENSE-hsr-optimizer.txt'), fs.readFileSync(path.join(SRC, 'LICENSE.md')));
if (args['app-release'] && fs.existsSync(args['app-release'])) fs.copyFileSync(args['app-release'], path.join(OUT, 'app.json'));

const files = {};
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f); const rel = path.relative(OUT, p).split(path.sep).join('/');
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (!/^manifest\./.test(rel)) { const b = fs.readFileSync(p); files[rel] = { sha256: crypto.createHash('sha256').update(b).digest('hex'), size: b.length }; }
  }
})(OUT);
const manifest = { format: 1, version, built: d.toISOString(), bridge: E.BRIDGE_VERSION, minApp: '1.6.0', files };
const mtxt = JSON.stringify(manifest, null, 1);
fs.writeFileSync(path.join(OUT, 'manifest.json'), mtxt);
const keyPem = args.key ? fs.readFileSync(args.key, 'utf8') : process.env.HSRPACK_KEY;
if (keyPem) {
  const sig = crypto.sign(null, Buffer.from(mtxt), crypto.createPrivateKey(keyPem));
  fs.writeFileSync(path.join(OUT, 'manifest.sig'), sig.toString('base64'));
  log('signed');
} else log('WARNING: manifest is not signed (no key)');
const total = Object.values(files).reduce((s, f) => s + f.size, 0);
log('done', version, Object.keys(chars).length, 'chars', Object.keys(lcs).length, 'lcs', Object.keys(sets).length, 'sets', (total / 1e6).toFixed(1) + ' MB');
process.exit(0);
