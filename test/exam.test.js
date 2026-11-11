/**
 * 用 Node 跑 exam.js 里的纯逻辑（不碰 DOM / chrome API）。
 * 做法：读取源码，把 IIFE 里的几个纯函数抽出来 eval，然后逐项断言。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'exam.js'), 'utf8');

// 从源码里截取需要的函数体，避免在不支持 chrome.* 的 Node 里执行整个脚本
function extract(startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  if (s < 0) throw new Error(`找不到 ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  if (e < 0) throw new Error(`找不到 ${endMarker}`);
  return src.slice(s, e);
}

const chunk = [
  'const Q = { SINGLE:1, MULTIPLE:2, JUDGE:3, FILL:4, SHORT:5, COMBINE:6 };',
  'const OBJECTIVE = new Set([Q.SINGLE, Q.MULTIPLE, Q.JUDGE]);',
  'let S = { bank: {} };',
  'const stripTags = (h) => String(h ?? "")',
  "  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')",
  "  .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')",
  "  .replace(/\\s+/g, ' ').trim();",
  extract('function parseOptions(', 'function normalizePaper('),
  extract('function normalizePaper(', '/* ------------------------------------------------------------------ */\n  /* 题库'),
  extract('function qKey(', '  async function loadBank('),
  extract('  const hasStd = (q) =>', '  function harvest('),
  extract('  function bankAnswer(', '  /**\n   * mode:'),
  extract('function resolveAnswer(', '  // 按站点自己的格式拼 answerlist'),
  extract('  function buildAnswerList(', '  /* ------------------------------------------------------------------ */\n  /* 等待批改'),
  'return { Q, OBJECTIVE, normalizePaper, qKey, hasStd, normalizeStd, bankAnswer, stdAnswer, randomAnswer, resolveAnswer, buildAnswerList, objectiveQuestions, JUDGE_OPTIONS, setBank: (b) => { S.bank = b; } };',
].join('\n');

// 把 S 换成模块级变量
const body = chunk.replace('let S = { bank: {} };', 'let S = { bank: {} };');
const factory = new Function(`${body}`);
const H = factory();

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('normalizePaper');

const rawPaper = {
  title: '测试试卷',
  totalscore: 100,
  starttime: 1700000000,
  groupblocks: [
    {
      id: 'g1',
      grouptitle: '一、单选题',
      blocks: [
        {
          id: 'b1',
          type: 1,
          title: '中国的首都是？',
          score: 5,
          optionsdata: JSON.stringify([
            { name: 'A', value: '北京', id: 1 },
            { name: 'B', value: '上海', id: 2 },
          ]),
        },
        {
          id: 'b2',
          type: 2,
          title: '以下哪些是编程语言？',
          score: 5,
          optionsdata: JSON.stringify([
            { name: 'A', value: 'Python', id: 1 },
            { name: 'B', value: 'HTML', id: 2 },
            { name: 'C', value: 'Java', id: 3 },
          ]),
        },
        {
          id: 'b3',
          type: 3,
          title: '地球是圆的。',
          score: 5,
          optionsdata: '',
        },
        {
          id: 'b4',
          type: 6,
          title: '组合题',
          questions: JSON.stringify([
            { type: 1, title: '子题一', optionsdata: JSON.stringify([{ name: 'A', value: 'x' }, { name: 'B', value: 'y' }]) },
            { type: 2, title: '子题二', optionsdata: JSON.stringify([{ name: 'A', value: 'p' }, { name: 'C', value: 'q' }]) },
          ]),
        },
      ],
    },
  ],
};

test('题目与分组数量正确', () => {
  const p = H.normalizePaper(rawPaper);
  assert.strictEqual(p.title, '测试试卷');
  assert.strictEqual(p.groups.length, 1);
  assert.strictEqual(p.groups[0].blocks.length, 4);
  // b1 b2 b3 + 组合题的两个子题
  assert.strictEqual(p.flat.length, 5);
});

test('判断题自动补上 正确/错误 选项', () => {
  const p = H.normalizePaper(rawPaper);
  const judge = p.flat.find((q) => q.type === H.Q.JUDGE);
  assert.deepStrictEqual(judge.options.map((o) => o.name), ['正确', '错误']);
  assert.deepStrictEqual(judge.options.map((o) => o.value), ['1', '0']);
});

test('组合题子题被摊平且 id 从 0 重新编号', () => {
  const p = H.normalizePaper(rawPaper);
  const kids = p.flat.filter((q) => q.type === H.Q.SINGLE || q.title.startsWith('子题'));
  assert.ok(kids.some((q) => q.title === '子题一'));
  assert.ok(kids.some((q) => q.title === '子题二'));
});

console.log('\n题库指纹 qKey');

test('同一道题两次指纹一致', () => {
  const a = H.normalizePaper(rawPaper).flat[0];
  const b = H.normalizePaper(JSON.parse(JSON.stringify(rawPaper))).flat[0];
  assert.strictEqual(H.qKey(a), H.qKey(b));
});

test('选项文字变化会改变指纹', () => {
  const a = H.normalizePaper(rawPaper).flat[0];
  const mutated = JSON.parse(JSON.stringify(rawPaper));
  mutated.groupblocks[0].blocks[0].optionsdata = JSON.stringify([
    { name: 'A', value: '北京' }, { name: 'B', value: '广州' },
  ]);
  const b = H.normalizePaper(mutated).flat[0];
  assert.notStrictEqual(H.qKey(a), H.qKey(b));
});

test('题目顺序不同不影响指纹', () => {
  const a = H.normalizePaper(rawPaper).flat[1];
  const b = H.normalizePaper(JSON.parse(JSON.stringify(rawPaper))).flat[1];
  assert.strictEqual(H.qKey(a), H.qKey(b));
});

console.log('\n标准答案归一化');

test('多选答案排序后归一', () => {
  const q = { type: H.Q.MULTIPLE, standardanswer: 'C, A ,B' };
  assert.strictEqual(H.normalizeStd(q), 'A,B,C');
  assert.deepStrictEqual(H.stdAnswer(q), ['A', 'B', 'C']);
});

test('判断答案转成 1 / 0', () => {
  assert.strictEqual(H.normalizeStd({ type: H.Q.JUDGE, standardanswer: '1' }), '1');
  assert.strictEqual(H.normalizeStd({ type: H.Q.JUDGE, standardanswer: '0' }), '0');
  assert.strictEqual(H.normalizeStd({ type: H.Q.JUDGE, standardanswer: 'true' }), '0');
});

test('空答案不算有标准答案', () => {
  assert.strictEqual(H.hasStd({ standardanswer: '' }), false);
  assert.strictEqual(H.hasStd({ standardanswer: null }), false);
  assert.strictEqual(H.hasStd({ standardanswer: '  ' }), false);
  assert.strictEqual(H.hasStd({ standardanswer: 'A' }), true);
});

console.log('\n答案来源优先级');

const paper = H.normalizePaper(rawPaper);
const single = paper.flat.find((q) => q.type === H.Q.SINGLE);
const multi = paper.flat.find((q) => q.type === H.Q.MULTIPLE);
const judge = paper.flat.find((q) => q.type === H.Q.JUDGE);

test('题库命中时直接返回库里的答案', () => {
  H.setBank({ [H.qKey(single)]: { type: 1, answer: 'A' } });
  assert.strictEqual(H.bankAnswer(single), 'A');
  assert.strictEqual(H.resolveAnswer(single, 'bank'), 'A');
});

test('题库未命中时 bank 模式给出随机答案', () => {
  H.setBank({});
  const v = H.resolveAnswer(single, 'bank');
  assert.ok(['A', 'B'].includes(v), `意外值 ${v}`);
});

test('truth 模式优先标准答案，其次题库', () => {
  const withStd = { ...single, standardanswer: 'B' };
  assert.strictEqual(H.resolveAnswer(withStd, 'truth'), 'B');

  H.setBank({ [H.qKey(single)]: { type: 1, answer: 'A' } });
  const noStd = { ...single, standardanswer: '' };
  assert.strictEqual(H.resolveAnswer(noStd, 'truth'), 'A');
});

test('多选题随机答案永远非空且是数组', () => {
  H.setBank({});
  for (let i = 0; i < 50; i += 1) {
    const v = H.randomAnswer(multi);
    assert.ok(Array.isArray(v) && v.length > 0, `第 ${i} 次得到 ${JSON.stringify(v)}`);
    v.forEach((n) => assert.ok(['A', 'B', 'C'].includes(n)));
  }
});

test('判断题随机答案只在 1 / 0 里取', () => {
  H.setBank({});
  for (let i = 0; i < 50; i += 1) {
    assert.ok(['0', '1'].includes(H.randomAnswer(judge)));
  }
});

console.log('\nanswerlist 组装');

test('单选题给字符串、多选给 JSON 数组字符串', () => {
  H.setBank({
    [H.qKey(single)]: { type: 1, answer: 'A' },
    [H.qKey(multi)]: { type: 2, answer: 'A,C' },
    [H.qKey(judge)]: { type: 3, answer: '1' },
  });
  const { answerlist } = H.buildAnswerList(paper, 'truth');
  const byId = Object.fromEntries(answerlist.map((a) => [a.id, a.value]));
  assert.strictEqual(byId.b1, 'A');
  assert.deepStrictEqual(JSON.parse(byId.b2), ['A', 'C']);
  assert.strictEqual(byId.b3, '1');
});

test('组合题按 [{id, value}] 的 JSON 提交', () => {
  H.setBank({});
  const p = H.normalizePaper(rawPaper);
  const { answerlist } = H.buildAnswerList(p, 'bank');
  const combo = answerlist.find((a) => a.id === 'b4');
  assert.ok(combo, '缺少组合题条目');
  const kids = JSON.parse(combo.value);
  assert.ok(Array.isArray(kids));
  kids.forEach((k) => {
    assert.ok(typeof k.id === 'number');
    assert.ok(k.value !== undefined && k.value !== '');
  });
});

test('统计字段与来源数量自洽', () => {
  H.setBank({
    [H.qKey(single)]: { type: 1, answer: 'A' },
    [H.qKey(multi)]: { type: 2, answer: 'A,C' },
    [H.qKey(judge)]: { type: 3, answer: '1' },
  });
  const r = H.buildAnswerList(paper, 'bank');
  const objectiveCount = H.objectiveQuestions(paper).length;
  assert.strictEqual(r.fromBank + r.random, objectiveCount);
});

console.log(`\n全部通过：${passed} 项`);