/** DCC Quick Start Guide p.2, Table 1-1; deliberately not the D20 formula. */
export function dccAbilityModifier(score) {
    if (!Number.isInteger(score) || score < 3 || score > 18)
        throw new RangeError('DCC base ability scores must be integers from 3 to 18.');
    if (score === 3)
        return -3;
    if (score <= 5)
        return -2;
    if (score <= 8)
        return -1;
    if (score <= 12)
        return 0;
    if (score <= 15)
        return 1;
    if (score <= 17)
        return 2;
    return 3;
}
//# sourceMappingURL=dcc.js.map