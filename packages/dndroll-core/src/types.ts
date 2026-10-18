export type Locale = 'zh' | 'en';
export interface Text { zh: string; en: string }
export type Ability = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
export type NativeAbility = Ability | 'AGI' | 'STA' | 'PER' | 'LCK';
export interface AbilityDisplay { slot: Ability; id: NativeAbility; name: Text }
/** Six keys for the selected edition, in its native notation. */
export type NativeScores = Partial<Record<NativeAbility, number>>;
export type Scores = Record<Ability, number>;
export type VersionId = 'odnd1974' | 'bx1981' | 'ose-classic' | 'adnd1e' | 'adnd2e' | 'dnd35' | 'pf1' | 'dnd5e2014' | 'dnd5e2024' | 'dcc';
export type Mode = 'fixed' | 'assign' | 'best-six' | 'best-per-ability' | 'pairs' | 'sets' | 'allocate' | 'pool' | 'buy' | 'array' | 'pending';
export type ClassId = 'fighter' | 'dwarf' | 'elf' | 'halfling' | 'magic-user' | 'cleric' | 'thief';
export interface Source { title: string; location: string; url: string; evidence: 'official-web' | 'transcription' | 'indexed-original' }
export interface Version { id: VersionId; name: Text; order: Ability[] }
export interface Method {
  id: string; versionId: VersionId; name: Text; description: Text;
  notes: Text[]; source: Source; status: 'ready' | 'pending';
  category: 'standard' | 'official-option'; mode: Mode;
  diceCount: number; keep: number; bonus: number;
  budgets: number[]; defaultBudget: number | null;
  costs: Record<string, number>; base: number;
  canChooseOrder: boolean; poolTotals: number[]; poolMax?: number; randomBudget?: boolean;
}
export interface SessionOptions { budget?: number; inOrder?: boolean; poolTotal?: number }
export interface CreateRequest { versionId: VersionId; methodId: string; options?: SessionOptions }
export type Action =
  | { type: 'roll' }
  | { type: 'rollExceptional' }
  | { type: 'buyExceptional'; percent: number }
  | { type: 'setPool'; counts: Scores }
  | { type: 'assign'; assignments: Partial<Record<Ability, string>> }
  | { type: 'choosePair'; ability: Ability; candidateId: string }
  | { type: 'chooseSet'; setId: string }
  | { type: 'allocateDie'; dieId: string; ability: Ability | null }
  | { type: 'setScore'; ability: Ability; score: number }
  | { type: 'selectClass'; classId: ClassId | null }
  | { type: 'trade'; from: Ability; to: Ability }
  | { type: 'resetAdjustments' }
  | { type: 'reroll'; reason: 'rule' | 'referee'; note?: string }
  | { type: 'finalize'; acceptUnspent?: boolean };
export interface Event { action: Action; dice: number[] }
/** Serializable event log. API outputs are deeply frozen. Never edit events directly. */
export interface Session { schemaVersion: 1; rulesVersion: string; request: CreateRequest; events: Event[] }
export type Rng = (sides: number) => number;
export interface Die { id: string; value: number; kept: boolean }
export interface Candidate { id: string; dice: Die[]; total: number; ability: Ability | null; setId: string | null; eligible: boolean }
export interface Trade { from: Ability; to: Ability }
export interface ClassOption { id: ClassId; name: Text; donors: Ability[]; targets: Ability[]; minimums: Partial<Scores> }
export interface Issue { code: string; severity: 'error' | 'warning'; message: Text }
export interface Attempt {
  exceptionalStrength: number | null;
  pointGeneration: { rolls: number[]; budget: number; maximum: number } | null;
  number: number; candidates: Candidate[]; looseDice: Die[];
  assignments: Partial<Record<Ability, string>>; selectedSet: string | null;
  allocations: Record<string, Ability>; baseScores: Partial<Scores>;
  scores: Partial<Scores>; selectedClass: ClassId | null; trades: Trade[];
  poolCounts: Scores; generated: boolean;
}
export interface SessionView {
  schemaVersion: 1; rulesVersion: string; version: Version; method: Method;
  options: SessionOptions; phase: 'configure' | 'roll' | 'assign' | 'choose-pairs' | 'choose-set' | 'allocate-dice' | 'point-buy' | 'review' | 'complete';
  attempt: Attempt; previousAttempts: Attempt[];
  exceptionalStrength: { value: number | null; mode: 'automatic' | 'roll' | 'purchase'; canRoll: boolean; canPurchase: boolean } | null;
  pointBuy: { budget: number; spent: number; remaining: number; costs: Record<string, number> } | null;
  classOptions: ClassOption[]; allowedActions: Action['type'][];
  issues: Issue[]; canFinalize: boolean; canRuleReroll: boolean; canRefereeReroll: boolean;
  notices: Text[]; eventCount: number;
}
export interface ExportedResult {
  schemaVersion: 1; rulesVersion: string; versionId: VersionId; methodId: string;
  abilityMapping: AbilityDisplay[]; nativeBaseScores: NativeScores; nativeScores: NativeScores; nativeModifiers: NativeScores | null;
  options: SessionOptions; baseScores: Scores; adjustedScores: Scores;
  exceptionalStrength: number | null; selectedClass: ClassId | null; source: Source; scope: 'ability-generation-only';
  notices: Text[]; attempts: Attempt[]; session: Session;
}

export interface BatchEntry { index: number; session: Session; view: SessionView }
