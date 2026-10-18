import { RuleError } from './errors.js';
import { applyAction, createSession, cryptoRng, getMethod, getSessionView } from './index.js';
import { freeze } from './catalog.js';
import type { BatchEntry, CreateRequest, Method, Rng, SessionOptions } from './types.js';

/** UI presets, not a DCC rule. The API accepts integer counts from 1 through 8. */
export const BATCH_COUNTS = freeze([1, 2, 4, 8] as const);
export const MAX_BATCH_SIZE = 8;
/** No pending allocation, pool configuration, class adjustment or player selection. */
export function isBatchMethod(method: Method, options: SessionOptions = {}): boolean {
  return method.status === 'ready' && !['bx1981','ose-classic'].includes(method.versionId) &&
    (method.mode === 'fixed' || method.mode === 'best-per-ability' ||
      (method.mode === 'assign' && method.canChooseOrder && options.inOrder === true));
}
export class BatchGenerationError extends RuleError {
  readonly group: number;
  readonly causeCode: string;
  override readonly cause: unknown;
  constructor(group: number, cause: unknown) {
    const error = cause instanceof RuleError ? cause : null;
    super('BATCH_GROUP_FAILED', `第 ${group} 组生成失败：${error?.messages.zh ?? String(cause)}。本次未返回批量结果。`,
      `Group ${group} failed: ${error?.messages.en ?? String(cause)}. No batch results were returned.`);
    this.name = 'BatchGenerationError'; this.group = group; this.cause = cause; this.causeCode = error?.code ?? 'UNKNOWN';
  }
}
/** Synchronous orchestration only. Each child owns a normal, replayable Session.
 * Failure returns no partial batch; an external RNG may already be consumed.
 */
export function generateBatch(request: CreateRequest, count: number, rng: Rng = cryptoRng): BatchEntry[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_SIZE)
    throw new RuleError('BATCH_COUNT','批量数量必须是 1–8 的整数。','Batch count must be an integer from 1 to 8.');
  const normalized = createSession(request).request;
  if (!isBatchMethod(getMethod(normalized.methodId), normalized.options))
    throw new RuleError('BATCH_UNSUPPORTED','该方法仍需玩家选择或配置，不能一键批量完成。','This method needs player choices or configuration and cannot be completed in one batch action.');
  const results: BatchEntry[] = [];
  for (let index = 1; index <= count; index++) {
    try {
      let session = createSession(normalized);
      session = applyAction(session, {type:'roll'}, rng);
      if (!getSessionView(session).canFinalize)
        throw new RuleError('INCOMPLETE','本组仍有未完成的选择。','This group still requires choices.');
      session = applyAction(session, {type:'finalize'}, rng);
      results.push({index, session, view:getSessionView(session)});
    } catch (error) { throw new BatchGenerationError(index, error); }
  }
  return freeze(results);
}
