import { text } from './catalog.js';
export class RuleError extends Error {
    code;
    messages;
    constructor(code, zh, en) {
        super(en);
        this.name = 'RuleError';
        this.code = code;
        this.messages = text(zh, en);
    }
}
//# sourceMappingURL=errors.js.map