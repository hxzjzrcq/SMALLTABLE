import { RuleError } from './errors.js';
export { RuleError };
import { dccAbilityModifier } from './dcc.js';
export { dccAbilityModifier };
import { getAbilityDisplay, getAbilityMapping, toNativeScores } from './ability-display.js';
export { getAbilityDisplay, getAbilityMapping, toNativeScores };
import { ABILITIES, RULES_VERSION } from './catalog.js';
import type { Ability, Action, CreateRequest, ExportedResult, Issue, Locale, Method, Rng, Session, SessionView, VersionId } from './types.js';
export type * from './types.js';
export { ABILITIES, RULES_VERSION };
export declare const isRandomMethod: (m: Method) => boolean;
export declare function formatAbilityScore(ab: Ability, score: number | undefined, percent?: number | null): string;
export declare const listVersions: () => import("./types.js").Version[];
export declare function listMethods(versionId: VersionId): Method[];
export declare function getMethod(id: string): Method;
export declare function createSession(request: CreateRequest): Session;
/** A random integer source; no Math.random fallback. Modulo bias is rejected. */
export declare function cryptoRng(sides: number): number;
/** Fixed dice for tests and demos only; never silently wraps around. */
export declare function sequenceRng(values: readonly number[]): Rng;
export declare function applyAction(session: Session, action: Action, rng?: Rng): Session;
export declare function getSessionView(session: Session): SessionView;
export declare function validateSession(session: Session): {
    valid: boolean;
    complete: boolean;
    issues: Issue[];
};
export declare function serializeSession(session: Session): string;
export declare function deserializeSession(json: string): Session;
export declare function exportResult(session: Session): ExportedResult;
export declare function formatResult(session: Session, locale?: Locale): string;
export { BATCH_COUNTS, MAX_BATCH_SIZE, isBatchMethod, generateBatch, BatchGenerationError } from './batch.js';
