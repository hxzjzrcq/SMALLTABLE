import { text } from './catalog.js';
import type { Text } from './types.js';

export class RuleError extends Error {
  readonly code: string;
  readonly messages: Text;
  constructor(code: string, zh: string, en: string) {
    super(en); this.name = 'RuleError'; this.code = code; this.messages = text(zh,en);
  }
}
