import { z } from 'zod';
import { rollDice } from './dice.js';

// Count Unicode code points, rather than UTF-16 code units. Reject controls before trimming.
const singleLine = (s: string) => !/[\p{Cc}\p{Cs}\u2028\u2029]/u.test(s);
export const rollReason = z
  .string()
  .refine(singleLine, '理由只能是单行纯文本')
  .transform((s) => s.trim())
  .refine((s) => [...s].length <= 32, '投骰理由最多 32 个 Unicode 字符');

/** Validate using the existing calculator with a deterministic source; never consume randomness. */
export function splitRollInput(input: string): { expression: string; reason?: string } {
  if (!singleLine(input)) throw Error('投骰输入只能是单行纯文本');
  const text = input.trim();
  let original: unknown;
  try {
    rollDice(text, () => 1);
    return { expression: text };
  } catch (e) {
    original = e;
  }
  // Prefer the longest valid prefix, preserving whitespace inside legal expressions.
  const boundaries = [...text.matchAll(/\s+/gu)].reverse();
  for (const match of boundaries) {
    const expression = text.slice(0, match.index);
    try {
      rollDice(expression, () => 1);
    } catch {
      continue;
    }
    const parsed = rollReason.safeParse(text.slice(match.index));
    if (!parsed.success) throw Error(parsed.error.issues[0].message);
    return { expression, ...(parsed.data ? { reason: parsed.data } : {}) };
  }
  throw original;
}
