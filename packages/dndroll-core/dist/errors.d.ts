import type { Text } from './types.js';
export declare class RuleError extends Error {
    readonly code: string;
    readonly messages: Text;
    constructor(code: string, zh: string, en: string);
}
