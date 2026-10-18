import { getAbilityDisplay } from '@dndroll/core';
import type { Ability, Locale, Text, VersionId } from '@dndroll/core';

/** UI 界面文案。规则说明文字一律来自 @dndroll/core，本文件只包含界面框架文本。 */
const dict = {
  batchCharacter: { zh: '角色 #{n}', en: 'Character #{n}' },
  batchView: { zh: '查看角色 #{n}', en: 'View character #{n}' },
  batchUse: { zh: '设为当前会话', en: 'Use as current session' },
  batchSessionJson: { zh: '完整会话 JSON（内部槽位）', en: 'Full Session JSON (internal slots)' },
  auditMapping: { zh: '内部槽位 → 对外属性', en: 'Internal slot → native ability' },
  batchTitle: { zh: '批量属性生成', en: 'Batch ability generation' },
  batchCount: { zh: '批量数量', en: 'Batch count' },
  batchGenerate: { zh: '生成批量', en: 'Generate batch' },
  batchLifetime: {
    zh: '本批量仅保存在当前页面内存中，刷新或关闭后清空。查看和导出不覆盖当前自动存档；只有明确“设为当前会话”才会替换。',
    en: 'This batch lives in page memory and clears on reload or close. Viewing and exporting leave the current autosave unchanged; only “Use as current session” replaces it.',
  },
  batchPresetHint: {
    zh: '1 / 2 / 4 / 8 是工具预设，不是规则人数限制。再次生成会替换本批量结果；单人会话与最近十组保持独立。',
    en: '1 / 2 / 4 / 8 are tool presets, not a rules restriction. Generating again replaces this batch; the single session and recent groups remain separate.',
  },
  batchPrevious: {
    zh: '仍保留并显示上一次成功的批量。',
    en: 'The previous successful batch is still shown.',
  },
  batchReady: { zh: '本批量：{n} 组', en: 'This batch: {n} groups' },
  modifier: { zh: '调整值', en: 'Modifier' },
  close: { zh: '关闭', en: 'Close' },
  appTitle: { zh: 'DNDROLL 属性生成器', en: 'DNDROLL Ability Generator' },
  appSubtitle: {
    zh: '多版本 D&D 属性掷骰工具 · 本地离线运行',
    en: 'Multi-edition D&D ability roller · runs fully offline',
  },
  language: { zh: 'English', en: '中文' },
  versions: { zh: '游戏版本', en: 'Game edition' },
  methods: { zh: '生成方法', en: 'Method' },
  pending: { zh: '待核准', en: 'Pending' },
  pendingNote: {
    zh: '该方法尚未核准，暂不可使用。',
    en: 'This method is pending verification and cannot be used yet.',
  },
  standard: { zh: '标准', en: 'Standard' },
  officialOption: { zh: '官方可选', en: 'Official option' },
  chooseMethod: { zh: '在左侧选择版本与生成方法', en: 'Pick an edition and a method on the left' },
  chooseMethodHint: {
    zh: '每种方法附原文说明与出处；禁用项表示规则仍在核准。',
    en: 'Every method shows its rules text and source; disabled entries are still under review.',
  },
  methodOptions: { zh: '开始前选项', en: 'Options before starting' },
  budget: { zh: '购点预算', en: 'Point budget' },
  poolTotal: { zh: '骰池总数', en: 'Dice pool total' },
  inOrder: { zh: '依序生成（3d6 按属性顺序固定）', en: 'In order (3d6 fixed to each ability)' },
  freeAssign: { zh: '自由分配', en: 'Free assignment' },
  start: { zh: '开始生成', en: 'Start generation' },
  browsingNotice: {
    zh: '正在浏览其他版本或方法；下方当前会话与存档保持不变。点击“开始生成”才会替换会话。',
    en: 'Browsing other editions or methods; the current session and save below are unchanged. Start generation to replace the session.',
  },
  backToSession: { zh: '返回当前会话', en: 'Back to current session' },
  exceptionalTitle: { zh: '传奇力量', en: 'Exceptional Strength' },
  rollExceptional: { zh: '投掷传奇力量（d100）', en: 'Roll exceptional Strength (d100)' },
  buyExceptional: {
    zh: '购买传奇力量（每 10% 花 1 点）',
    en: 'Buy exceptional Strength (1 point per 10%)',
  },
  exceptionalAutomatic: {
    zh: '本组已自动投掷 d100；重新分配后沿用同一结果。',
    en: 'This group rolled d100 automatically; reassigning retains the same result.',
  },
  exceptionalConvention: {
    zh: '本工具不检查传奇力量的职业、种族或性别条件及上限，请自行按团规处理。',
    en: 'This tool does not enforce exceptional Strength class, race or sex eligibility or caps; apply your table’s rules yourself.',
  },
  scoreCap: { zh: '单项上限', en: 'Score cap' },
  rollBudgetHint: {
    zh: '投 2d6，查表确定总预算与单项上限，然后分配全部属性点。',
    en: 'Roll 2d6 for the total budget and score cap, then distribute all ability points.',
  },
  poolHint2e: {
    zh: '分配 24 颗 d6，每项至少 3 颗、最多 6 颗；确认后掷骰，各取最高三颗。',
    en: 'Allocate 24d6, 3–6 per ability; confirm and roll, keeping each ability’s highest three.',
  },
  lightTheme: { zh: '浅色模式', en: 'Light mode' },
  darkTheme: { zh: '深色模式', en: 'Dark mode' },
  quickRoll: { zh: '快速掷骰', en: 'Quick roll' },
  quickRollHint: {
    zh: '新组独立生成，旧组保留在下方历史中。',
    en: 'Roll a separate group; previous groups remain in the history below.',
  },
  historyCandidates: { zh: '候选值', en: 'Candidates' },
  historyDice: { zh: '七颗骰', en: 'Seven dice' },
  historyScores: { zh: '当前属性', en: 'Current abilities' },
  historySets: {
    zh: '展开十二套数值（✓ 为已选套）',
    en: 'Show all twelve sets (✓ marks the selected set)',
  },
  nextGroup: { zh: '再掷一组', en: 'Roll another group' },
  recentGroups: { zh: '最近生成', en: 'Recent groups' },
  historyGroup: { zh: '第 {n} 组', en: 'Group {n}' },
  historyHint: {
    zh: '保留最近 10 组（含当前组）；点击恢复，不会重掷。刷新或关闭后历史清空，当前会话仍按原方式自动保存。',
    en: 'Keeps the latest 10 groups including the current group. Click to restore without rolling. History clears on reload or close; the current session still autosaves as before.',
  },
  newSession: { zh: '新建会话', en: 'New session' },
  abandonTitle: { zh: '放弃当前进度？', en: 'Discard current progress?' },
  abandonBody: {
    zh: '当前会话已有进度，替换或新建会放弃它。如需保留请先导出存档。',
    en: 'This session has progress. Replacing or restarting discards it — export the save first if you want to keep it.',
  },
  confirm: { zh: '放弃并继续', en: 'Discard and continue' },
  cancel: { zh: '取消', en: 'Cancel' },
  roll: { zh: '掷骰', en: 'Roll' },
  rollHint: {
    zh: '结果由安全随机源在本地生成，本次尝试只能掷一次。',
    en: 'Results are generated locally by a secure RNG; one roll per attempt.',
  },
  configureFirst: {
    zh: '先完成上方配置，再掷骰。',
    en: 'Finish the configuration above before rolling.',
  },
  assignTitle: { zh: '分配结果', en: 'Assign results' },
  assignHint: {
    zh: '先点选一个结果，再点选要放入的属性；点已占用可撤销该格。',
    en: 'Click a result, then click an ability slot; click an occupied slot to clear it.',
  },
  pairsHint: {
    zh: '每项属性从两个结果中任选其一，可以选较低值。',
    en: 'Choose either of the two results per ability — the lower one is allowed.',
  },
  setsHint: {
    zh: '十二套属性中选择完整的一套，不能跨套拼接。',
    en: 'Pick one complete set of six; no mixing across sets.',
  },
  placeDie: { zh: '将选中骰子放入此属性', en: 'Place the selected die in this ability' },
  recallDie: { zh: '撤回骰子', en: 'Recall die' },
  allocateHint: {
    zh: '点选一颗骰子，再点目标属性放入；点已放置的骰子撤回。属性不能超过 18。',
    en: 'Click a die, then an ability to place it; click a placed die to take it back. No score may exceed 18.',
  },
  poolHint: {
    zh: '把骰池分配到六项属性，每项至少 3 颗，总和必须恰好等于骰池总数；确认后才能掷骰。',
    en: 'Distribute the pool across six abilities, at least 3 dice each, using exactly the full pool; confirm before rolling.',
  },
  pointBuyHint: {
    zh: '逐项调整数值；允许临时超支以便调整，但超支不能完成。',
    en: 'Adjust each score; temporary overspending is allowed while editing, but you cannot finalize over budget.',
  },
  candidates: { zh: '候选结果', en: 'Candidate results' },
  abilities: { zh: '属性', en: 'Abilities' },
  assigned: { zh: '已分配', en: 'Assigned' },
  unassigned: { zh: '未分配', en: 'Unassigned' },
  kept: { zh: '保留', en: 'kept' },
  dropped: { zh: '舍弃', en: 'dropped' },
  eligible: { zh: '可保留', en: 'eligible' },
  notEligible: { zh: '低于前六门槛', en: 'below the top-six cutoff' },
  total: { zh: '总和', en: 'Total' },
  set: { zh: '第 {n} 套', en: 'Set {n}' },
  unallocated: { zh: '未分配骰子', en: 'Unallocated dice' },
  spent: { zh: '已花费', en: 'Spent' },
  remaining: { zh: '剩余', en: 'Remaining' },
  costTable: { zh: '成本表', en: 'Cost table' },
  score: { zh: '数值', en: 'Score' },
  cost: { zh: '成本', en: 'Cost' },
  classTitle: { zh: '职业与主属性调整', en: 'Class & prime-requisite adjustments' },
  classNone: { zh: '不选择职业', en: 'No class' },
  classResetNote: {
    zh: '选择或改换职业会重置本次所有主属性交换。',
    en: 'Choosing or changing the class resets all exchanges of this attempt.',
  },
  classMinimums: { zh: '最低要求', en: 'Minimums' },
  tradeFrom: { zh: '供出（-2）', en: 'Donor (-2)' },
  tradeTo: { zh: '目标（+1）', en: 'Target (+1)' },
  tradeDo: { zh: '执行交换', en: 'Apply exchange' },
  tradeLog: { zh: '已执行交换', en: 'Exchanges made' },
  tradeReset: { zh: '撤销全部调整', en: 'Reset adjustments' },
  rerollRule: { zh: '按规则重掷整组', en: 'Reroll the set by rule' },
  rerollReferee: { zh: '主持人许可重建', en: 'Replace with referee permission' },
  refereeNote: { zh: '主持人许可说明（必填）', en: 'Referee permission note (required)' },
  refereeNotePlaceholder: {
    zh: '例如：主持人确认该角色不适合冒险，许可重新生成。',
    en: 'e.g. The referee agreed this character is unfit for play and allowed a replacement.',
  },
  rerollDo: { zh: '记录并重掷', en: 'Record and reroll' },
  previousAttempts: { zh: '已弃用的尝试', en: 'Discarded attempts' },
  attempt: { zh: '第 {n} 次生成', en: 'Attempt {n}' },
  finalize: { zh: '确认完成并锁定', en: 'Finalize and lock' },
  finalizeNote: {
    zh: '完成后会话锁定，只能查看与导出。',
    en: 'After finalizing the session is locked to view and export only.',
  },
  acceptUnspent: { zh: '确认保留未用完的点数', en: 'Keep the unspent points' },
  resultTitle: { zh: '属性生成结果', en: 'Ability generation result' },
  baseScores: { zh: '基础属性', en: 'Base scores' },
  adjustedScores: { zh: '调整后属性', en: 'Adjusted scores' },
  notices: { zh: '说明', en: 'Notices' },
  issues: { zh: '待处理', en: 'To resolve' },
  source: { zh: '规则出处', en: 'Rules source' },
  copyResult: { zh: '复制结果文本', en: 'Copy result text' },
  copyOk: { zh: '已复制到剪贴板。', en: 'Copied to clipboard.' },
  copyFail: {
    zh: '当前环境不允许直接写入剪贴板（file:// 常见）。请改用下方文本框全选复制，或下载 TXT。',
    en: 'Direct clipboard access is unavailable here (common under file://). Select the text below, or download the TXT instead.',
  },
  downloadTxt: { zh: '下载 TXT', en: 'Download TXT' },
  exportJson: { zh: '导出存档 JSON', en: 'Export save JSON' },
  exportResultJson: { zh: '导出结果 JSON', en: 'Export result JSON' },
  importJson: { zh: '导入存档', en: 'Import save' },
  importTitle: { zh: '导入存档 JSON', en: 'Import a save JSON' },
  importHint: {
    zh: '选择此前导出的存档文件，或粘贴其文本。导入会校验并重放全部操作记录。',
    en: 'Choose a previously exported save file, or paste its text. The log is replayed and validated on import.',
  },
  importFile: { zh: '选择文件…', en: 'Choose file…' },
  importDo: { zh: '校验并恢复', en: 'Validate and restore' },
  importFail: { zh: '存档无法恢复', en: 'Save could not be restored' },
  restored: { zh: '已从存档恢复会话。', en: 'Session restored from save.' },
  savedBanner: {
    zh: '检测到上次未完成的会话，已自动恢复。',
    en: 'Resumed your previous unfinished session.',
  },
  savedCorrupt: {
    zh: '本地保存的会话无法读取（可能已损坏或版本不兼容）。旧存档未被清除；自动保存已暂停，请明确清除旧存档后再保存新会话。',
    en: 'The locally saved session could not be read (corrupted or incompatible). It was not deleted. Autosave is paused until you explicitly clear the old save.',
  },
  clearSaved: { zh: '清除本地存档', en: 'Clear saved data' },
  errorPrefix: { zh: '操作被拒绝', en: 'Action rejected' },
  completed: { zh: '已完成', en: 'Completed' },
  stepConfigure: { zh: '配置', en: 'Configure' },
  stepRoll: { zh: '掷骰', en: 'Roll' },
  stepAssign: { zh: '分配', en: 'Assign' },
  stepReview: { zh: '核对', en: 'Review' },
  stepDone: { zh: '完成', en: 'Done' },
  emptyWorkspace: {
    zh: '选择一种方法后，在这里完成掷骰、分配与导出。',
    en: 'Choose a method, then roll, assign and export here.',
  },
  rulesVersion: { zh: '规则版本', en: 'Rules version' },
  offlineNote: {
    zh: '本页面完全离线运行；不使用网络、遥测或登录。',
    en: 'This page runs fully offline; no network, telemetry or sign-in.',
  },
  showText: { zh: '显示可选中文本', en: 'Show selectable text' },
  hideText: { zh: '收起文本', en: 'Hide text' },
  diceDetail: { zh: '骰子明细', en: 'Dice detail' },
  selectedClass: { zh: '职业', en: 'Class' },
  poolCommitted: { zh: '配置已确认，可以掷骰。', en: 'Configuration confirmed — ready to roll.' },
  confirmConfig: { zh: '确认骰数配置', en: 'Confirm dice counts' },
  poolDirty: { zh: '骰数有未确认的修改。', en: 'Dice counts have unconfirmed changes.' },
  poolEach3: { zh: '每项至少 3 颗', en: 'at least 3 per ability' },
  optionNote: {
    zh: '选好方法与选项后，点击“开始生成”新建会话。',
    en: 'Choose the method and options, then click Start generation to create a session.',
  },
} satisfies Record<string, Text>;

export type UiKey = keyof typeof dict;

export function t(key: UiKey, locale: Locale, vars?: Record<string, string | number>): string {
  let s: string = dict[key][locale];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Core owns edition-specific abbreviations and full names, including 2E 灵知. */
export function getAbilityName(versionId: VersionId, ability: Ability, locale: Locale): string {
  return getAbilityDisplay(versionId, ability).name[locale];
}
