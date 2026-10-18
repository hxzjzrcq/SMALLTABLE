/** Parser independent of UI, sockets and random implementation. No eval. */
export function rollDice(input: string, random: (sides: number) => number) {
  if (input.length > 128) throw Error('表达式过长');
  const expression = input.replace(/\s/g, '').toLowerCase();
  if (!/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/.test(expression))
    throw Error('只支持 NdM 与整数加减');
  const terms = expression.match(/[+-]?[^+-]+/g)!;
  let count = 0,
    result = 0;
  const dice: { sign: 1 | -1; sides: number; values: number[] }[] = [];
  const canonical: string[] = [];
  for (const raw of terms) {
    const sign: 1 | -1 = raw.startsWith('-') ? -1 : 1;
    const body = raw.replace(/^[+-]/, '');
    let term: number, normalized: string;
    if (body.includes('d')) {
      const [n, m] = body.split('d');
      const amount = n === '' ? 1 : Number(n),
        sides = Number(m);
      if (
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        !Number.isSafeInteger(sides) ||
        sides < 2 ||
        sides > 1000 ||
        (count += amount) > 100
      )
        throw Error('最多 100 枚骰子，骰面须为 2–1000');
      const values = Array.from({ length: amount }, () => {
        const v = random(sides);
        if (!Number.isInteger(v) || v < 1 || v > sides) throw Error('无效随机源');
        return v;
      });
      dice.push({ sign, sides, values });
      term = values.reduce((a, b) => a + b, 0);
      normalized = `${amount}d${sides}`;
    } else {
      term = Number(body);
      if (!Number.isSafeInteger(term)) throw Error('整数过大');
      normalized = String(term);
    }
    result += sign * term;
    if (!Number.isSafeInteger(result)) throw Error('结果超出安全整数');
    canonical.push(`${sign === -1 ? '-' : canonical.length ? '+' : ''}${normalized}`);
  }
  if (!dice.length) throw Error('至少包含一枚骰子');
  return { expression: canonical.join(''), dice, result };
}
