import type { Ability, AbilityDisplay, NativeScores, Scores, VersionId } from './types.js';
/** Internal slots never change meaning in stored events; this is the public display mapping. */
export declare function getAbilityDisplay(versionId: VersionId, slot: Ability): AbilityDisplay;
export declare function getAbilityMapping(versionId: VersionId): AbilityDisplay[];
export declare function toNativeScores(versionId: VersionId, scores: Partial<Scores>): NativeScores;
