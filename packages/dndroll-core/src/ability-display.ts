import { ABILITIES, freeze, versions } from './catalog.js';
import type { Ability, AbilityDisplay, NativeScores, Scores, VersionId } from './types.js';

const standard: Record<Ability, AbilityDisplay> = freeze({
  STR: {slot:'STR',id:'STR',name:{zh:'力量',en:'Strength'}},
  DEX: {slot:'DEX',id:'DEX',name:{zh:'敏捷',en:'Dexterity'}},
  CON: {slot:'CON',id:'CON',name:{zh:'体质',en:'Constitution'}},
  INT: {slot:'INT',id:'INT',name:{zh:'智力',en:'Intelligence'}},
  WIS: {slot:'WIS',id:'WIS',name:{zh:'感知',en:'Wisdom'}},
  CHA: {slot:'CHA',id:'CHA',name:{zh:'魅力',en:'Charisma'}},
});
const dcc: Record<Ability, AbilityDisplay> = freeze({
  STR: standard.STR,
  DEX: {slot:'DEX',id:'AGI',name:{zh:'敏捷',en:'Agility'}},
  CON: {slot:'CON',id:'STA',name:{zh:'耐力',en:'Stamina'}},
  WIS: {slot:'WIS',id:'PER',name:{zh:'人格',en:'Personality'}},
  INT: standard.INT,
  CHA: {slot:'CHA',id:'LCK',name:{zh:'幸运',en:'Luck'}},
});
const wisdom2e: AbilityDisplay = freeze({slot:'WIS',id:'WIS',name:{zh:'灵知',en:'Wisdom'}});
/** Internal slots never change meaning in stored events; this is the public display mapping. */
export function getAbilityDisplay(versionId: VersionId, slot: Ability): AbilityDisplay {
  if (!versions.some(v=>v.id===versionId) || !ABILITIES.includes(slot)) throw new RangeError('Unknown edition or ability slot.');
  return versionId==='dcc'?dcc[slot]:versionId==='adnd2e'&&slot==='WIS'?wisdom2e:standard[slot];
}
export function getAbilityMapping(versionId: VersionId): AbilityDisplay[] {
  const version=versions.find(v=>v.id===versionId);
  if (!version) throw new RangeError('Unknown edition.');
  return freeze(version.order.map(slot=>getAbilityDisplay(versionId,slot)));
}
export function toNativeScores(versionId: VersionId, scores: Partial<Scores>): NativeScores {
  return freeze(Object.fromEntries(getAbilityMapping(versionId)
    .filter(({slot})=>scores[slot]!==undefined).map(({slot,id})=>[id,scores[slot]!])));
}
