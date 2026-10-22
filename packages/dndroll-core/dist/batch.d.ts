import { RuleError } from './errors.js';
import type { BatchEntry, CreateRequest, Method, Rng, SessionOptions } from './types.js';
/** UI presets, not a DCC rule. The API accepts integer counts from 1 through 8. */
export declare const BATCH_COUNTS: readonly [1, 2, 4, 8];
export declare const MAX_BATCH_SIZE = 8;
/** No pending allocation, pool configuration, class adjustment or player selection. */
export declare function isBatchMethod(method: Method, options?: SessionOptions): boolean;
export declare class BatchGenerationError extends RuleError {
    readonly group: number;
    readonly causeCode: string;
    readonly cause: unknown;
    constructor(group: number, cause: unknown);
}
/** Synchronous orchestration only. Each child owns a normal, replayable Session.
 * Failure returns no partial batch; an external RNG may already be consumed.
 */
export declare function generateBatch(request: CreateRequest, count: number, rng?: Rng): BatchEntry[];
