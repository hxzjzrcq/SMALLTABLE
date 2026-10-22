import { RuleError } from './errors.js';
export { RuleError };
import { dccAbilityModifier } from './dcc.js';
export { dccAbilityModifier };
import { getAbilityDisplay, getAbilityMapping, toNativeScores } from './ability-display.js';
export { getAbilityDisplay, getAbilityMapping, toNativeScores };
import { ABILITIES, RULES_VERSION, classes, freeze, methods, text, versions } from './catalog.js';
export { ABILITIES, RULES_VERSION };
function requireRule(ok, code, zh, en) {
    if (!ok)
        throw new RuleError(code, zh, en);
}
function object(v) {
    requireRule(v !== null && typeof v === 'object' && !Array.isArray(v), 'BAD_OBJECT', '需要对象。', 'Expected an object.');
}
function keys(v, allowed) {
    requireRule(Object.keys(v).every(k => allowed.includes(k)), 'UNKNOWN_FIELD', '包含未知字段。', 'Unknown field.');
}
const ability = (v) => ABILITIES.includes(v);
export const isRandomMethod = (m) => m.status === 'ready' && (m.randomBudget === true || !['buy', 'array'].includes(m.mode));
export function formatAbilityScore(ab, score, percent = null) {
    return score === undefined ? '—' : ab === 'STR' && score === 18 && percent !== null ? `18/${percent === 100 ? '00' : String(percent).padStart(2, '0')}` : String(score);
}
const exceptionalVersion = (m) => m.versionId === 'adnd1e' || m.versionId === 'adnd2e';
const classMode = (m) => m.versionId === 'bx1981' || m.versionId === 'ose-classic';
const allScores = (n) => Object.fromEntries(ABILITIES.map(a => [a, n]));
const sum = (values) => values.reduce((a, b) => a + b, 0);
export const listVersions = () => versions;
export function listMethods(versionId) {
    requireRule(versions.some(v => v.id === versionId), 'UNKNOWN_VERSION', '未知游戏版本。', 'Unknown game version.');
    return freeze(methods.filter(m => m.versionId === versionId));
}
export function getMethod(id) {
    const m = methods.find(m => m.id === id);
    requireRule(m, 'UNKNOWN_METHOD', '未知生成方法。', 'Unknown generation method.');
    return m;
}
function normalizeRequest(input) {
    object(input);
    keys(input, ['versionId', 'methodId', 'options']);
    requireRule(typeof input.methodId === 'string', 'BAD_REQUEST', '需要方法标识。', 'Method ID required.');
    const m = getMethod(input.methodId);
    requireRule(input.versionId === m.versionId, 'VERSION_MISMATCH', '方法不属于该版本。', 'Method does not belong to this version.');
    requireRule(m.status === 'ready', 'METHOD_PENDING', '该方法尚未核准，暂不可用。', 'This method is pending verification.');
    const opts = input.options ?? {};
    object(opts);
    keys(opts, ['budget', 'inOrder', 'poolTotal']);
    const options = {};
    if (m.mode === 'buy' && !m.randomBudget) {
        const budget = opts.budget ?? m.defaultBudget;
        requireRule(typeof budget === 'number' && m.budgets.includes(budget), 'BAD_BUDGET', '请选择已列出的官方预算。', 'Select a listed official budget.');
        options.budget = budget;
    }
    else
        requireRule(opts.budget === undefined, 'BAD_OPTION', '该方法不使用购点预算。', 'This method has no point budget.');
    if (m.canChooseOrder) {
        requireRule(opts.inOrder === undefined || typeof opts.inOrder === 'boolean', 'BAD_OPTION', '依序选项须为布尔值。', 'inOrder must be boolean.');
        options.inOrder = opts.inOrder ?? false;
    }
    else
        requireRule(opts.inOrder === undefined, 'BAD_OPTION', '该方法不能切换顺序。', 'This method has no order option.');
    if (m.mode === 'pool') {
        const total = opts.poolTotal ?? 24;
        requireRule(typeof total === 'number' && m.poolTotals.includes(total), 'BAD_POOL', '骰池总数须为 24 或 28。', 'Pool total must be 24 or 28.');
        options.poolTotal = total;
    }
    else
        requireRule(opts.poolTotal === undefined, 'BAD_OPTION', '该方法没有骰池总数。', 'This method has no pool total.');
    return { versionId: m.versionId, methodId: m.id, options };
}
export function createSession(request) {
    return freeze({ schemaVersion: 1, rulesVersion: RULES_VERSION, request: normalizeRequest(request), events: [] });
}
/** A random integer source; no Math.random fallback. Modulo bias is rejected. */
export function cryptoRng(sides) {
    requireRule(Number.isInteger(sides) && sides >= 2 && sides <= 0x100000000, 'BAD_SIDES', '骰子面数无效。', 'Invalid die sides.');
    requireRule(typeof globalThis.crypto?.getRandomValues === 'function', 'NO_CRYPTO', '当前环境没有安全随机数源，请由适配器提供。', 'No secure random source; provide one from the adapter.');
    const a = new Uint32Array(1), limit = Math.floor(0x100000000 / sides) * sides;
    do {
        globalThis.crypto.getRandomValues(a);
    } while (a[0] >= limit);
    return a[0] % sides + 1;
}
/** Fixed dice for tests and demos only; never silently wraps around. */
export function sequenceRng(values) {
    const copy = [...values];
    let i = 0;
    return sides => { const n = copy[i++]; requireRule(Number.isInteger(n) && n >= 1 && n <= sides, 'BAD_RNG', '固定骰序列耗尽或数值无效。', 'Fixed dice exhausted or invalid.'); return n; };
}
function normalizedAction(input) {
    object(input);
    const t = input.type;
    requireRule(typeof t === 'string', 'BAD_ACTION', '缺少操作类型。', 'Action type required.');
    const fields = { roll: [], rollExceptional: [], buyExceptional: ['percent'], setPool: ['counts'], assign: ['assignments'], choosePair: ['ability', 'candidateId'], chooseSet: ['setId'], allocateDie: ['dieId', 'ability'], setScore: ['ability', 'score'], selectClass: ['classId'], trade: ['from', 'to'], resetAdjustments: [], reroll: ['reason', 'note'], finalize: ['acceptUnspent'] };
    requireRule(Object.hasOwn(fields, t), 'BAD_ACTION', '未知操作。', 'Unknown action.');
    keys(input, ['type', ...fields[t]]);
    switch (t) {
        case 'buyExceptional':
            requireRule(Number.isInteger(input.percent) && input.percent >= 0 && input.percent <= 100 && input.percent % 10 === 0, 'BAD_PERCENT', '购买百分比须为 0–100 的十倍数。', 'Purchased percentage must be a multiple of ten from 0 to 100.');
            break;
        case 'setPool':
            object(input.counts);
            keys(input.counts, ABILITIES);
            requireRule(ABILITIES.every(a => Number.isInteger(input.counts[a])), 'BAD_POOL', '六项骰数必须为整数。', 'All six dice counts must be integers.');
            break;
        case 'assign':
            object(input.assignments);
            keys(input.assignments, ABILITIES);
            requireRule(Object.values(input.assignments).every(v => typeof v === 'string'), 'BAD_ASSIGNMENT', '候选结果标识必须为字符串。', 'Candidate IDs must be strings.');
            break;
        case 'choosePair':
            requireRule(ability(input.ability) && typeof input.candidateId === 'string', 'BAD_ACTION', '选择参数无效。', 'Invalid pair selection.');
            break;
        case 'chooseSet':
            requireRule(typeof input.setId === 'string', 'BAD_ACTION', '缺少整套标识。', 'Set ID required.');
            break;
        case 'allocateDie':
            requireRule(typeof input.dieId === 'string' && (input.ability === null || ability(input.ability)), 'BAD_ACTION', '骰子分配参数无效。', 'Invalid die allocation.');
            break;
        case 'setScore':
            requireRule(ability(input.ability) && Number.isInteger(input.score), 'BAD_ACTION', '属性或数值无效。', 'Invalid ability or score.');
            break;
        case 'selectClass':
            requireRule(input.classId === null || classes.some(c => c.id === input.classId), 'BAD_CLASS', '未知职业。', 'Unknown class.');
            break;
        case 'trade':
            requireRule(ability(input.from) && ability(input.to), 'BAD_ACTION', '交换属性无效。', 'Invalid exchange abilities.');
            break;
        case 'reroll':
            requireRule(input.reason === 'rule' || input.reason === 'referee', 'BAD_REASON', '须指定重掷理由。', 'Reroll reason required.');
            requireRule(input.note === undefined || (typeof input.note === 'string' && input.note.length <= 500), 'BAD_NOTE', '说明必须是 500 字符以内的文本。', 'Note must be text of at most 500 characters.');
            break;
        case 'finalize':
            requireRule(input.acceptUnspent === undefined || typeof input.acceptUnspent === 'boolean', 'BAD_ACTION', '确认参数无效。', 'Invalid confirmation.');
            break;
    }
    return structuredClone(input);
}
function newAttempt(m, number) {
    const a = { number, exceptionalStrength: null, pointGeneration: null, candidates: [], looseDice: [], assignments: {}, selectedSet: null, allocations: {}, baseScores: {}, scores: {}, selectedClass: null, trades: [], poolCounts: allScores(3), generated: false };
    if (m.mode === 'buy' && !m.randomBudget) {
        a.baseScores = allScores(m.base);
        a.scores = { ...a.baseScores };
        a.generated = true;
    }
    if (m.mode === 'array') {
        a.candidates = [15, 14, 13, 12, 10, 8].map((total, i) => ({ id: `a${number}.r${i + 1}`, total, dice: [], ability: null, setId: null, eligible: true }));
        a.generated = true;
    }
    return a;
}
function rollAttempt(r, rng) {
    const m = r.method, a = r.attempt, order = versions.find(v => v.id === m.versionId).order;
    const die = () => { const n = rng(6); requireRule(Number.isInteger(n) && n >= 1 && n <= 6, 'BAD_RNG', '随机源必须返回 1–6 的整数。', 'RNG must return an integer from 1 to 6.'); return n; };
    function group(count, target = null, setId = null) {
        const id = `a${a.number}.r${a.candidates.length + 1}`;
        const values = Array.from({ length: count }, () => die());
        const kept = new Set(values.map((v, i) => ({ v, i })).sort((x, y) => y.v - x.v || x.i - y.i).slice(0, m.keep).map(x => x.i));
        const dice = values.map((value, i) => ({ id: `${id}.d${i + 1}`, value, kept: kept.has(i) }));
        const c = { id, dice, total: sum(dice.filter(d => d.kept).map(d => d.value)) + m.bonus, ability: target, setId, eligible: true };
        a.candidates.push(c);
        return c;
    }
    if (m.randomBudget) {
        const rolls = [die(), die()], row = POINT_GENERATION[sum(rolls) - 2];
        a.pointGeneration = { rolls, budget: row[0], maximum: row[1] };
        a.baseScores = allScores(3);
        a.scores = { ...a.baseScores };
        a.generated = true;
        return;
    }
    if (m.mode === 'allocate') {
        a.looseDice = Array.from({ length: 7 }, (_, i) => ({ id: `a${a.number}.d${i + 1}`, value: die(), kept: true }));
        a.baseScores = allScores(8);
    }
    else if (m.mode === 'sets') {
        for (let i = 1; i <= 12; i++)
            for (const stat of order)
                group(3, stat, `a${a.number}.set${i}`);
    }
    else if (m.mode === 'pairs' || m.mode === 'best-per-ability') {
        for (const stat of order) {
            const batch = Array.from({ length: m.mode === 'pairs' ? 2 : 6 }, () => group(3, stat));
            if (m.mode === 'best-per-ability') {
                const best = [...batch].sort((x, y) => y.total - x.total)[0];
                a.assignments[stat] = best.id;
                a.baseScores[stat] = best.total;
            }
        }
    }
    else if (m.mode === 'pool') {
        for (const stat of order) {
            const c = group(a.poolCounts[stat], stat);
            a.baseScores[stat] = c.total;
            a.assignments[stat] = c.id;
        }
    }
    else {
        const fixed = m.mode === 'fixed' || r.request.options?.inOrder === true;
        const count = m.mode === 'best-six' || m.id === 'adnd2e.phb-IV' ? 12 : 6;
        for (let i = 0; i < count; i++) {
            const target = fixed ? order[i] : null, c = group(m.diceCount, target);
            if (target) {
                a.baseScores[target] = c.total;
                a.assignments[target] = c.id;
            }
        }
        if (m.mode === 'best-six') {
            const cutoff = [...a.candidates].sort((x, y) => y.total - x.total)[5].total;
            for (const c of a.candidates)
                c.eligible = c.total >= cutoff;
        }
    }
    a.generated = true;
    a.scores = { ...a.baseScores };
}
const POINT_GENERATION = [[68, 18], [70, 18], [72, 17], [72, 18], [74, 17], [74, 18], [76, 17], [76, 16], [78, 16], [78, 15], [80, 15]];
function pointBuy(r) {
    if (r.method.mode !== 'buy' || !r.attempt.generated)
        return null;
    const costs = Object.fromEntries(Object.entries(r.method.costs).filter(([score]) => Number(score) <= (r.attempt.pointGeneration?.maximum ?? 18)));
    const extra = r.method.id === 'adnd2e.sp-X' && r.attempt.scores.STR === 18 ? (r.attempt.exceptionalStrength ?? 0) / 10 : 0;
    const spent = sum(ABILITIES.map(a => costs[String(r.attempt.scores[a])])) + extra, budget = r.attempt.pointGeneration?.budget ?? r.request.options.budget;
    return { spent, budget, remaining: budget - spent, costs };
}
function issues(r) {
    const out = [], a = r.attempt;
    const push = (code, zh, en, severity = 'error') => out.push({ code, severity, message: text(zh, en) });
    if (!a.generated)
        push('NOT_GENERATED', '尚未生成属性。', 'Generate scores first.');
    else if (!ABILITIES.every(s => a.scores[s] !== undefined))
        push('INCOMPLETE', '请完成所有选择或分配。', 'Complete all selections or assignments.');
    if (r.method.mode === 'allocate' && a.generated && Object.keys(a.allocations).length !== 7)
        push('UNALLOCATED', '还有骰子未分配。', 'Some dice remain unallocated.');
    if (r.method.mode === 'best-six' && Object.keys(a.assignments).length === 6) {
        const chosen = Object.values(a.assignments).map(id => a.candidates.find(c => c.id === id).total).sort((x, y) => y - x);
        const expected = a.candidates.map(c => c.total).sort((x, y) => y - x).slice(0, 6);
        if (chosen.some((n, i) => n !== expected[i]))
            push('NOT_BEST_SIX', '必须保留最高六个总和。', 'Retain the six highest totals.');
    }
    const pb = pointBuy(r);
    if (pb && pb.remaining < 0)
        push('OVER_BUDGET', '购点超出预算。', 'Point budget exceeded.');
    if (pb && pb.remaining > 0)
        push('UNSPENT', r.method.id.startsWith('adnd2e.sp-') ? '必须分配全部属性点。' : '仍有点数未使用；完成时需明确确认。', r.method.id.startsWith('adnd2e.sp-') ? 'Allocate all ability points.' : 'Points remain; explicitly acknowledge them when finalizing.', r.method.id.startsWith('adnd2e.sp-') ? 'error' : 'warning');
    if (exceptionalVersion(r.method) && r.method.mode === 'buy' && r.method.id !== 'adnd2e.sp-X' && a.scores.STR === 18 && a.exceptionalStrength === null)
        push('EXCEPTIONAL_REQUIRED', '请点击投掷传奇力量。', 'Click to roll exceptional Strength.');
    return out;
}
function ruleReroll(r) {
    if (r.method.id !== 'dnd35.phb-roll' || !r.attempt.generated)
        return false;
    const vals = r.attempt.candidates.map(c => c.total);
    return Math.max(...vals) <= 13 || sum(vals.map(v => Math.floor((v - 10) / 2))) <= 0;
}
function transition(r, action, rng) {
    requireRule(!r.done, 'COMPLETED', '已完成的记录不能修改，请新建一次生成。', 'Completed sessions are locked; start a new session.');
    const a = r.attempt, m = r.method;
    const generated = () => requireRule(a.generated, 'NOT_GENERATED', '请先生成属性。', 'Generate scores first.');
    switch (action.type) {
        case 'rollExceptional': {
            generated();
            requireRule(exceptionalVersion(m) && a.scores.STR === 18 && m.id !== 'adnd2e.sp-X' && a.exceptionalStrength === null, 'EXCEPTIONAL_NOT_ALLOWED', '当前不能投掷传奇力量。', 'Exceptional Strength cannot be rolled now.');
            const n = rng(100);
            requireRule(Number.isInteger(n) && n >= 1 && n <= 100, 'BAD_RNG', '百分骰必须为 1–100。', 'Percentile die must be 1–100.');
            a.exceptionalStrength = n;
            break;
        }
        case 'buyExceptional':
            generated();
            requireRule(m.id === 'adnd2e.sp-X' && a.scores.STR === 18, 'EXCEPTIONAL_NOT_ALLOWED', '只有方法 X 的 STR 18 可购买传奇力量。', 'Only Method X at STR 18 can buy exceptional Strength.');
            a.exceptionalStrength = action.percent || null;
            break;
        case 'setPool':
            requireRule(m.mode === 'pool' && !a.generated, 'WRONG_PHASE', '只能在掷骰前分配骰数。', 'Allocate pool counts before rolling.');
            requireRule(ABILITIES.every(s => action.counts[s] >= 3 && action.counts[s] <= (m.poolMax ?? r.request.options.poolTotal)), 'BAD_POOL', '每项骰数超出本方法范围。', 'Dice count outside this method’s range.');
            requireRule(sum(Object.values(action.counts)) === r.request.options.poolTotal, 'BAD_POOL_TOTAL', '必须恰好分配全部骰池。', 'Allocate exactly the full dice pool.');
            a.poolCounts = { ...action.counts };
            break;
        case 'roll':
            requireRule(!a.generated, 'ALREADY_ROLLED', '已经生成，不能重复掷骰。', 'Already generated; cannot roll again.');
            if (m.mode === 'pool')
                requireRule(sum(Object.values(a.poolCounts)) === r.request.options.poolTotal, 'BAD_POOL_TOTAL', '请先分配全部骰池。', 'Allocate the full pool first.');
            rollAttempt(r, rng);
            break;
        case 'assign': {
            generated();
            requireRule(['assign', 'best-six', 'array'].includes(m.mode) && !r.request.options?.inOrder, 'WRONG_ACTION', '该方法不能自由分配。', 'This method does not permit free assignment.');
            const ids = Object.values(action.assignments);
            requireRule(new Set(ids).size === ids.length, 'DUPLICATE_RESULT', '同一个结果不能重复使用。', 'A result cannot be assigned twice.');
            requireRule(ids.every(id => a.candidates.some(c => c.id === id && c.eligible)), 'BAD_CANDIDATE', '结果不存在或不可选择。', 'Unknown or ineligible candidate.');
            a.assignments = { ...action.assignments };
            a.baseScores = {};
            for (const stat of ABILITIES) {
                const id = a.assignments[stat];
                if (id)
                    a.baseScores[stat] = a.candidates.find(c => c.id === id).total;
            }
            a.scores = { ...a.baseScores };
            break;
        }
        case 'choosePair': {
            generated();
            requireRule(m.mode === 'pairs', 'WRONG_ACTION', '该方法不是逐项二选一。', 'Not a per-ability pair method.');
            const c = a.candidates.find(c => c.id === action.candidateId && c.ability === action.ability);
            requireRule(c, 'BAD_CANDIDATE', '只能选择该属性的候选结果。', 'Choose a candidate belonging to this ability.');
            a.assignments[action.ability] = c.id;
            a.baseScores[action.ability] = c.total;
            a.scores = { ...a.baseScores };
            break;
        }
        case 'chooseSet':
            generated();
            requireRule(m.mode === 'sets', 'WRONG_ACTION', '该方法不是整套选择。', 'Not a whole-set method.');
            {
                const cs = a.candidates.filter(c => c.setId === action.setId);
                requireRule(cs.length === 6, 'BAD_SET', '整套标识无效。', 'Invalid set ID.');
                a.selectedSet = action.setId;
                for (const c of cs) {
                    a.baseScores[c.ability] = c.total;
                    a.assignments[c.ability] = c.id;
                }
                a.scores = { ...a.baseScores };
            }
            break;
        case 'allocateDie': {
            generated();
            requireRule(m.mode === 'allocate', 'WRONG_ACTION', '该方法不能分配单颗骰子。', 'Not a rolled-die allocation method.');
            requireRule(a.looseDice.some(d => d.id === action.dieId), 'BAD_DIE', '骰子标识不存在。', 'Unknown die ID.');
            const allocation = { ...a.allocations };
            delete allocation[action.dieId];
            if (action.ability)
                allocation[action.dieId] = action.ability;
            const scores = allScores(8);
            for (const d of a.looseDice) {
                const target = allocation[d.id];
                if (target)
                    scores[target] += d.value;
            }
            requireRule(ABILITIES.every(s => scores[s] <= 18), 'SCORE_CAP', '分配后不能超过 18。', 'Allocation would exceed 18.');
            a.allocations = allocation;
            a.baseScores = scores;
            a.scores = { ...scores };
            break;
        }
        case 'setScore':
            requireRule(m.mode === 'buy', 'WRONG_ACTION', '只有购点允许直接设置属性。', 'Direct score setting is for point buy.');
            requireRule(Object.hasOwn(pointBuy(r)?.costs ?? {}, String(action.score)), 'SCORE_RANGE', '数值超出本版购点范围。', 'Score outside this method’s purchase range.');
            if (m.id === 'adnd2e.sp-X' && action.ability === 'STR' && action.score !== 18)
                a.exceptionalStrength = null;
            a.baseScores[action.ability] = action.score;
            a.scores = { ...a.baseScores };
            break;
        case 'selectClass': {
            generated();
            requireRule(classMode(m), 'WRONG_ACTION', '此步骤仅用于 B/X 与 OSE 经典职业调整。', 'This step is for B/X and OSE Classic adjustments.');
            const c = classes.find(c => c.id === action.classId);
            if (c)
                requireRule(ABILITIES.every(s => (a.baseScores[s] ?? 0) >= (c.minimums[s] ?? 0)), 'CLASS_MINIMUM', '原始属性不满足该职业最低要求。', 'Base scores do not meet this class’s minimums.');
            a.selectedClass = action.classId;
            a.trades = [];
            a.scores = { ...a.baseScores };
            break;
        }
        case 'trade': {
            generated();
            requireRule(classMode(m), 'WRONG_ACTION', '该方法没有主属性交换。', 'This method has no prime-requisite exchange.');
            const c = classes.find(c => c.id === a.selectedClass);
            requireRule(c, 'CLASS_REQUIRED', '请先选择职业。', 'Choose a class first.');
            requireRule(c.donors.includes(action.from) && c.targets.includes(action.to), 'BAD_TRADE', '职业不允许此交换。', 'Class does not permit this exchange.');
            requireRule(a.scores[action.from] >= 11 && a.scores[action.to] < 18, 'BAD_TRADE_RANGE', '供出属性不能低于 9，目标不能超过 18。', 'Donor cannot fall below 9; target cannot exceed 18.');
            a.scores[action.from] -= 2;
            a.scores[action.to] += 1;
            a.trades.push({ from: action.from, to: action.to });
            break;
        }
        case 'resetAdjustments':
            generated();
            requireRule(classMode(m), 'WRONG_ACTION', '该方法没有主属性调整。', 'This method has no prime-requisite adjustments.');
            a.trades = [];
            a.scores = { ...a.baseScores };
            break;
        case 'reroll':
            generated();
            if (action.reason === 'rule')
                requireRule(ruleReroll(r), 'REROLL_NOT_ALLOWED', '不满足此方法的重掷条件。', 'This method’s reroll criteria are not met.');
            else {
                requireRule(classMode(m), 'REROLL_NOT_ALLOWED', '此方法未提供该主持人裁定操作。', 'This method has no such referee replacement operation.');
                requireRule(action.note?.trim(), 'REFEREE_NOTE_REQUIRED', '请记录主持人许可说明。', 'Record the referee’s permission.');
            }
            r.previous.push(structuredClone(a));
            r.attempt = newAttempt(m, a.number + 1);
            rollAttempt(r, rng);
            break;
        case 'finalize': {
            const list = issues(r);
            requireRule(!list.some(i => i.severity === 'error'), 'INCOMPLETE', '还有未完成或不合法的步骤。', 'Incomplete or invalid generation.');
            requireRule(!list.some(i => i.code === 'UNSPENT') || action.acceptUnspent === true, 'UNSPENT_CONFIRMATION', '请确认保留未用点数，或继续购点。', 'Confirm unspent points or continue buying.');
            r.done = true;
            break;
        }
    }
}
function replay(input) {
    object(input);
    keys(input, ['schemaVersion', 'rulesVersion', 'request', 'events']);
    requireRule(input.schemaVersion === 1 && (input.rulesVersion === RULES_VERSION || input.rulesVersion === '0.1.0-2026-10-17'), 'SCHEMA_VERSION', '存档版本不受支持。', 'Unsupported save or rules version.');
    const request = normalizeRequest(input.request), method = getMethod(request.methodId);
    requireRule(Array.isArray(input.events) && input.events.length <= 2048, 'BAD_EVENTS', '操作记录格式错误或超过 2048 项。', 'Invalid event log or more than 2048 events.');
    const runtime = { rulesVersion: input.rulesVersion, request, method, attempt: newAttempt(method, 1), previous: [], done: false }, events = [];
    for (const e of input.events) {
        object(e);
        keys(e, ['action', 'dice']);
        const action = normalizedAction(e.action);
        requireRule(Array.isArray(e.dice) && e.dice.length <= 216 && e.dice.every(n => Number.isInteger(n) && n >= 1 && n <= 100), 'BAD_DICE_LOG', '骰子记录无效。', 'Invalid dice log.');
        const dice = e.dice;
        let index = 0;
        transition(runtime, action, (sides) => { const n = dice[index++]; requireRule(n !== undefined, 'MISSING_DICE', '骰子记录不完整。', 'Missing recorded dice.'); requireRule(n >= 1 && n <= sides, 'BAD_DICE_LOG', '记录骰值超出骰面范围。', 'Recorded die exceeds die sides.'); return n; });
        requireRule(index === dice.length, 'EXTRA_DICE', '记录包含多余骰子。', 'Extraneous recorded dice.');
        events.push({ action, dice: [...dice] });
    }
    return { session: { schemaVersion: 1, rulesVersion: input.rulesVersion, request, events }, runtime };
}
export function applyAction(session, action, rng = cryptoRng) {
    const { session: copy, runtime } = replay(session);
    requireRule(copy.events.length < 2048, 'EVENT_LIMIT', '本次操作记录已达上限，请另建会话。', 'Event limit reached; start another session.');
    const checked = normalizedAction(action);
    const add = (a) => {
        requireRule(copy.events.length < 2048, 'EVENT_LIMIT', '操作记录已达上限。', 'Event limit reached.');
        const dice = [];
        transition(runtime, a, sides => { const n = rng(sides); dice.push(n); return n; });
        copy.events.push({ action: a, dice });
    };
    const auto = () => exceptionalVersion(runtime.method) && runtime.method.mode !== 'buy' && runtime.attempt.scores.STR === 18 && runtime.attempt.exceptionalStrength === null && !runtime.done;
    if (checked.type === 'finalize' && auto())
        add({ type: 'rollExceptional' });
    add(checked);
    if (auto())
        add({ type: 'rollExceptional' });
    copy.rulesVersion = RULES_VERSION;
    return freeze(copy);
}
function view(r, eventCount) {
    const m = r.method, a = r.attempt, list = issues(r), complete = !list.some(i => i.severity === 'error');
    let phase = 'review', allowed = [];
    if (r.done)
        phase = 'complete';
    else if (!a.generated) {
        phase = m.mode === 'pool' ? 'configure' : 'roll';
        allowed = m.mode === 'pool' ? ['setPool', 'roll'] : ['roll'];
    }
    else {
        if (m.mode === 'buy') {
            phase = 'point-buy';
            allowed.push('setScore');
        }
        else if (m.mode === 'pairs') {
            phase = complete ? 'review' : 'choose-pairs';
            allowed.push('choosePair');
        }
        else if (m.mode === 'sets') {
            phase = complete ? 'review' : 'choose-set';
            allowed.push('chooseSet');
        }
        else if (m.mode === 'allocate') {
            phase = complete ? 'review' : 'allocate-dice';
            allowed.push('allocateDie');
        }
        else if (['array', 'assign', 'best-six'].includes(m.mode) && !r.request.options?.inOrder) {
            phase = complete ? 'review' : 'assign';
            allowed.push('assign');
        }
        if (exceptionalVersion(m) && a.scores.STR === 18) {
            if (m.id === 'adnd2e.sp-X')
                allowed.push('buyExceptional');
            else if (a.exceptionalStrength === null)
                allowed.push('rollExceptional');
        }
        if (classMode(m))
            allowed.push('selectClass', 'resetAdjustments', ...(a.selectedClass ? ['trade'] : []));
        if (ruleReroll(r) || classMode(m))
            allowed.push('reroll');
        if (complete)
            allowed.push('finalize');
    }
    const notices = [text('这是属性生成结果，不是完整人物卡。', 'This is ability generation, not a complete character sheet.')];
    if (r.rulesVersion !== RULES_VERSION)
        notices.push(text('此为 v0.1 旧存档，保留原骰点；继续修改时升级至当前规则版本，并按需补投传奇力量。', 'This is a v0.1 save. Existing rolls are preserved; further edits upgrade it to the current rules version and roll exceptional Strength when required.'));
    if (m.versionId === 'dnd5e2024')
        notices.push(text('尚未应用背景属性增加。', 'Background ability increases are not applied.'));
    else if (['pf1', 'dnd35', 'dnd5e2014'].includes(m.versionId))
        notices.push(text('尚未应用种族属性调整。', 'Racial ability adjustments are not applied.'));
    else if (m.versionId === 'adnd1e' || m.versionId === 'adnd2e')
        notices.push(text('传奇力量按本工具约定，不检查职业、种族或性别资格与上限；请自行按团规处理。其他职业、种族条件及调整尚未应用。', 'Exceptional Strength ignores class, race and sex eligibility and caps by this tool’s convention; apply your table’s rules yourself. Other class/race checks and adjustments are not applied.'));
    else if (m.versionId === 'odnd1974')
        notices.push(text('未进行主属性经验换算。', 'Prime-requisite XP conversion is not applied.'));
    else if (classMode(m) && !a.selectedClass)
        notices.push(text('尚未选择职业或进行主属性调整。', 'Class selection and prime-requisite adjustments were skipped.'));
    return freeze({ schemaVersion: 1, rulesVersion: r.rulesVersion, version: versions.find(v => v.id === m.versionId), method: m, options: r.request.options, phase, attempt: a, previousAttempts: r.previous, exceptionalStrength: exceptionalVersion(m) && a.scores.STR === 18 ? { value: a.exceptionalStrength, mode: m.id === 'adnd2e.sp-X' ? 'purchase' : m.mode === 'buy' ? 'roll' : 'automatic', canRoll: !r.done && m.id !== 'adnd2e.sp-X' && a.exceptionalStrength === null, canPurchase: !r.done && m.id === 'adnd2e.sp-X' } : null, pointBuy: pointBuy(r), classOptions: classMode(m) ? classes : [], allowedActions: allowed, issues: list, canFinalize: !r.done && complete, canRuleReroll: !r.done && ruleReroll(r), canRefereeReroll: !r.done && a.generated && classMode(m), notices, eventCount });
}
export function getSessionView(session) { const { session: s, runtime } = replay(session); return view(runtime, s.events.length); }
export function validateSession(session) {
    try {
        const v = getSessionView(session);
        return freeze({ valid: !v.issues.some(i => i.severity === 'error'), complete: v.phase === 'complete', issues: v.issues });
    }
    catch (e) {
        if (e instanceof RuleError)
            return freeze({ valid: false, complete: false, issues: [{ code: e.code, severity: 'error', message: e.messages }] });
        throw e;
    }
}
export function serializeSession(session) { return JSON.stringify(replay(session).session); }
export function deserializeSession(json) {
    requireRule(typeof json === 'string' && json.length <= 2_000_000, 'SAVE_SIZE', '存档过大或不是文本。', 'Save is not text or exceeds 2 MB.');
    let input;
    try {
        input = JSON.parse(json);
    }
    catch {
        throw new RuleError('BAD_JSON', '存档不是有效 JSON。', 'Invalid JSON save.');
    }
    return freeze(replay(input).session);
}
export function exportResult(session) {
    const { session: s, runtime: r } = replay(session);
    requireRule(r.done, 'NOT_FINALIZED', '请先确认完成。', 'Finalize the session first.');
    const v = view(r, s.events.length);
    return freeze({ schemaVersion: 1, rulesVersion: RULES_VERSION, versionId: s.request.versionId, methodId: s.request.methodId, options: s.request.options, abilityMapping: getAbilityMapping(s.request.versionId), nativeBaseScores: toNativeScores(s.request.versionId, r.attempt.baseScores), nativeScores: toNativeScores(s.request.versionId, r.attempt.scores), nativeModifiers: s.request.versionId === 'dcc' ? toNativeScores('dcc', Object.fromEntries(ABILITIES.map(ab => [ab, dccAbilityModifier(r.attempt.scores[ab])]))) : null, baseScores: r.attempt.baseScores, adjustedScores: r.attempt.scores, exceptionalStrength: r.attempt.scores.STR === 18 ? r.attempt.exceptionalStrength : null, selectedClass: r.attempt.selectedClass, source: r.method.source, scope: 'ability-generation-only', notices: v.notices, attempts: [...r.previous, r.attempt], session: s });
}
export function formatResult(session, locale = 'zh') {
    requireRule(locale === 'zh' || locale === 'en', 'BAD_LOCALE', '语言须为 zh 或 en。', 'Locale must be zh or en.');
    const r = exportResult(session), m = getMethod(r.methodId), v = versions.find(v => v.id === r.versionId);
    const label = (slot) => getAbilityDisplay(v.id, slot).id;
    const lines = [`${v.name[locale]} · ${m.name[locale]}`, m.description[locale], v.order.map(a => `${label(a)} ${formatAbilityScore(a, r.adjustedScores[a], r.exceptionalStrength)}${r.nativeModifiers ? ` (${r.nativeModifiers[label(a)] > 0 ? '+' : ''}${r.nativeModifiers[label(a)]})` : ''}`).join(' / '), `${locale === 'zh' ? '基础值' : 'Base'}: ${v.order.map(a => `${label(a)} ${r.baseScores[a]}`).join(' / ')}`, `${locale === 'zh' ? '方法选项' : 'Options'}: ${JSON.stringify(r.options)}`];
    for (const a of r.attempts) {
        lines.push(`${locale === 'zh' ? '生成次数' : 'Attempt'} ${a.number}`);
        for (const c of a.candidates) {
            const bonus = c.total - sum(c.dice.filter(d => d.kept).map(d => d.value));
            const expression = c.dice.length ? c.dice.map(d => d.kept ? String(d.value) : `[${d.value}]`).join('+') + (bonus ? `+${bonus}` : '') : (locale === 'zh' ? '固定数组' : 'array');
            lines.push(`${c.id}${c.ability ? ' ' + label(c.ability) : ''}${c.setId ? ' ' + c.setId : ''}: ${expression} = ${c.total}`);
        }
        for (const d of a.looseDice)
            lines.push(`${d.id}: ${d.value} → ${a.allocations[d.id] ? label(a.allocations[d.id]) : '—'}`);
        if (a.exceptionalStrength !== null)
            lines.push(`${locale === 'zh' ? '传奇力量' : 'Exceptional Strength'}: ${formatAbilityScore('STR', 18, a.exceptionalStrength)}`);
        if (a.pointGeneration)
            lines.push(`${locale === 'zh' ? '预算骰' : 'Budget roll'}: ${a.pointGeneration.rolls.join('+')} → ${a.pointGeneration.budget}, max ${a.pointGeneration.maximum}`);
        if (Object.keys(a.assignments).length)
            lines.push(`${locale === 'zh' ? '结果分配' : 'Assignments'}: ${JSON.stringify(Object.fromEntries(Object.entries(a.assignments).map(([slot, id]) => [label(slot), id])))}`);
        if (a.selectedClass)
            lines.push(`${locale === 'zh' ? '职业' : 'Class'}: ${classes.find(c => c.id === a.selectedClass).name[locale]}`);
        for (const t of a.trades)
            lines.push(`${label(t.from)} -2 → ${label(t.to)} +1`);
    }
    for (const e of r.session.events)
        if (e.action.type === 'reroll')
            lines.push(`${locale === 'zh' ? '重掷' : 'Reroll'}: ${e.action.reason}${e.action.note ? ' — ' + e.action.note : ''}`);
    lines.push(`${m.source.title}, ${m.source.location}`, m.source.url, ...r.notices.map(n => n[locale]), `Rules ${r.session.rulesVersion}`);
    return lines.join('\n');
}
export { BATCH_COUNTS, MAX_BATCH_SIZE, isBatchMethod, generateBatch, BatchGenerationError } from './batch.js';
//# sourceMappingURL=index.js.map