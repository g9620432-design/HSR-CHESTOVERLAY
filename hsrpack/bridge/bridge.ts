// HSR Chest Overlay — мост к расчётному движку HSR Optimizer (MIT License, (c) Fribbels).
// Собирается вместе с исходниками движка в один файл engine.mjs.
import { Metadata } from 'lib/state/metadataInitializer'
import { getGameMetadata } from 'lib/state/gameMetadata'
import { getAllCharacterConfigs } from 'lib/conditionals/resolver/characterConfigRegistry'
import { RelicScorer } from 'lib/relics/scoring/relicScorer'
import { RelicAugmenter } from 'lib/relics/relicAugmenter'
import { CharacterConverter } from 'lib/importer/characterConverter'
import { KelzFormatParser } from 'lib/importer/kelzFormatParser'
import { KelzScannerConfig, ReliquaryArchiverConfig } from 'lib/importer/importConfig'
import { executeOrchestrator, executeUpgradeOrchestrator, prepareOrchestrator, resolveSimulationMetadata } from 'lib/simulations/orchestrator/runDpsScoreBenchmarkOrchestrator'
import { runComputeOptimalSimulationInline } from 'lib/worker/computeOptimalSimulationWorkerRunner'
import { DEFAULT_TEAM } from 'lib/constants/constants'
import { ScoringConfigType } from 'types/metadata'

export const BRIDGE_VERSION = 1
let ready = false
export function init() {
  if (!ready) { Metadata.initialize(); ready = true; (globalThis as any).SEQUENTIAL_BENCHMARKS = true }
  return Object.keys(getGameMetadata().characters).length
}
export function rawMeta() { return getGameMetadata() }
export function defaultLightCones() {
  const o: Record<string, string> = {}
  for (const [id, c] of getAllCharacterConfigs()) o[id] = (c as any).defaultLightCone
  return o
}

export function augment(relic: any) { return RelicAugmenter.augment({ ...relic }) }

function scoreOne(r: any, charId: string) {
  const cur = RelicScorer.scoreCurrentRelic(r, charId as any)
  const pot = RelicScorer.scoreRelicPotential(r, charId as any) as any
  return { pct: cur.percentScore, rating: cur.rating, best: pot.bestPct, avg: pot.averagePct, worst: pot.worstPct }
}
export function scoreRelic(relic: any, charId: string) {
  const r = relic.augmentedStats ? relic : RelicAugmenter.augment({ ...relic }) as any
  return scoreOne(r, charId)
}
// оценка набора реликвий для набора персонажей: для каждой — лучшие варианты
export function scoreRelics(relics: any[], charIds: string[], top = 3) {
  const out: any[] = []
  for (const relic of relics) {
    const r = relic.augmentedStats ? relic : RelicAugmenter.augment({ ...relic }) as any
    if (!r) { out.push(null); continue }
    const list: any[] = []
    for (const c of charIds) {
      try { const s = scoreOne(r, c); list.push({ c, ...s }) } catch { /* персонаж без оценки */ }
    }
    list.sort((a, b) => (b.avg - a.avg) || (b.pct - a.pct))
    const own = r.equippedBy ? list.find((x) => x.c === r.equippedBy) || (() => { try { return { c: r.equippedBy, ...scoreOne(r, r.equippedBy) } } catch { return null } })() : null
    out.push({ top: list.slice(0, top), own })
  }
  return out
}

function fixAvatar(a: any) {
  const c = { ...a }
  c.relicList = (a.relicList || []).map((r: any) => ({ ...r, subAffixList: Array.isArray(r.subAffixList) ? r.subAffixList : [] }))
  return c
}
// у переработанных персонажей (b1) игра сохраняет старый id — берём новую версию, если она вышла
export function mapCharId(id: string) {
  const m = getGameMetadata().characters as any
  const b = `${id}b1`
  return m[b] && !m[b].unreleased ? b : id
}
export function convertEnka(avatar: any) {
  const c: any = CharacterConverter.convert(fixAvatar(avatar))
  const id = mapCharId(String(c.id))
  if (id !== c.id) { c.id = id; c.form.characterId = id; for (const r of Object.values(c.equipped) as any[]) r.equippedBy = id }
  return c
}

export function parseScanner(json: any) {
  const src = String(json && json.source || '')
  const cfg = src === ReliquaryArchiverConfig.sourceString ? ReliquaryArchiverConfig : KelzScannerConfig
  const p = new KelzFormatParser({ ...cfg, sourceString: src || cfg.sourceString, latestOutputVersion: json.version })
  return p.parse(json)
}

const runner = async (input: any) => runComputeOptimalSimulationInline(input)
function prep(converted: any, ct: ScoringConfigType, team?: any[]) {
  const sim = resolveSimulationMetadata(converted, ct, DEFAULT_TEAM)
  if (!sim) return null
  if (Array.isArray(team) && team.length === 3) {
    sim.teammates = team.map((t: any, i: number) => ({ ...(sim.teammates[i] || {}), characterId: t.characterId, lightCone: t.lightCone, characterEidolon: t.characterEidolon | 0, lightConeSuperimposition: Math.max(1, t.lightConeSuperimposition | 0) })) as any
  }
  const orch = prepareOrchestrator(converted, { configType: ct, simulation: sim } as any, converted.equipped, { spdBenchmark: undefined } as any)
  return { sim, orch }
}
function statsOf(res: any) {
  if (!res || !res.x) return null
  let combat: any = null, basic: any = null
  try { combat = res.x.toComputedStatsObject() } catch { /* */ }
  try { basic = res.x.c && res.x.c.toBasicStatsObject ? res.x.c.toBasicStatsObject() : null } catch { /* */ }
  return { combat, basic, actionDamage: res.actionDamage || null, rotation: (res.rotationDamage || []).map((s: any) => ({ k: s.actionType, n: s.actionName, d: s.damage })), simScore: res.simScore }
}
function reqOf(r: any) { return r ? { s1: r.simRelicSet1, s2: r.simRelicSet2, o: r.simOrnamentSet, body: r.simBody, feet: r.simFeet, sphere: r.simPlanarSphere, rope: r.simLinkRope, stats: r.stats } : null }

// быстрый расчёт урона текущего билда (без поиска эталона)
export function simulate(converted: any, configType = 'dps', team?: any[]) {
  const p = prep(converted, configType as ScoringConfigType, team)
  if (!p) return null
  return { team: p.sim.teammates, ...statsOf(p.orch.originalSimResult) }
}

// полная оценка билда: проценты, эталон и советы по улучшению
export async function analyze(converted: any, configType = 'dps', withUpgrades = true, team?: any[]) {
  const ct = configType as ScoringConfigType
  const p = prep(converted, ct, team)
  if (!p) return null
  const o: any = p.orch
  await executeOrchestrator(o, { searchRunner: runner as any, scoreOnly: !withUpgrades })
  if (withUpgrades) { try { await executeUpgradeOrchestrator(o) } catch (e) { /* советы не обязательны */ } }
  const ups = (list: any[]) => (list || []).map((u: any) => ({ part: u.part, stat: u.stat, pct: u.percent, set: u.simulation && u.simulation.request ? reqOf(u.simulation.request) : null })).filter((u: any) => Number.isFinite(u.pct))
  return {
    percent: o.percent, spd: o.originalSpd, spdBenchmark: o.spdBenchmark,
    team: p.sim.teammates,
    original: statsOf(o.originalSimResult),
    benchmark: withUpgrades ? statsOf(o.benchmarkSimResult) : null,
    benchmarkBuild: reqOf(o.benchmarkSimRequest), perfectionBuild: reqOf(o.perfectionSimRequest),
    scores: { original: o.originalSimResult && o.originalSimResult.simScore, baseline: o.benchmarkBaselineScore, benchmark: o.benchmarkSimScore, perfection: o.perfectionSimScore },
    substatUpgrades: ups(o.substatUpgradeResults), mainUpgrades: ups(o.mainUpgradeResults), setUpgrades: ups(o.setUpgradeResults),
  }
}
