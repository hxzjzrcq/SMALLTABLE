import type { Ability, ClassOption, Method, Text, Version } from './types.js';
export declare const RULES_VERSION = "0.4.0-2026-10-18";
export declare const ABILITIES: Ability[];
export declare const OLD_ORDER: Ability[];
export declare const text: (zh: string, en: string) => Text;
export declare function freeze<T>(value: T): T;
export declare const versions: Version[];
export declare const methods: Method[];
export declare const classes: ClassOption[];
