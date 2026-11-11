/**
 * 考试 / 作业自动答题助手（hbnun.lsedu.vip）
 *
 * 平台允许“提交一次 → 查看标准答案 → 再提交一次”，本脚本按这个流程自动跑：
 *
 *   1. 打开试卷（页面自身用 getPaperDetail，会生成一次作答记录并返回开始时间）；
 *   2. 若有历史提交记录，先从历史详情里把 standardanswer 收进本地题库；
 *   3. 题库覆盖全部客观题 → 直接按标准答案提交一次；
 *      没覆盖且还能再考 → 先提交一版（题库有的用题库，没有的随机）→
 *      等系统批改 → 取回标准答案入库 → 再提交一版全对的；
 *   4. 主观题（填空/简答）没有标准答案，跳过并在日志里标出。
 *
 * 所有请求都是页面自己在用的接口，token 取自当前登录 cookie；
 * 脚本不接管账号、不处理密码，只在你已登录的浏览器里替你作答与提交。
 */
(() => {
  'use strict';

  const V = '1.1.0';
  const HOST_ID = 'exam-helper-host';
  const GEN = (window.__EXAM_HELPER_GEN__ || 0) + 1;
  window.__EXAM_HELPER_GEN__ = GEN;
  if (window.__EXAM_HELPER_VERSION__ === V) return;
  window.__EXAM_HELPER_VERSION__ = V;
  const alive = () => window.__EXAM_HELPER_GEN__ === GEN;

  const API = 'https://adulteduapi.lsedu.vip';
  const BANK_KEY = 'examAnswerBank';

  // QuestionTypeEnum
  const Q = { SINGLE: 1, MULTIPLE: 2, JUDGE: 3, FILL: 4, SHORT: 5, COMBINE: 6 };
  const OBJECTIVE = new Set([Q.SINGLE, Q.MULTIPLE, Q.JUDGE]);
  // PaperTypeEnum
  const TYPE = { EXAM: 1, HOMEWORK: 2 };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const S = {
    running: false,
    stop: false,
    logs: [],
    bank: {},
    stats: { items: 0, submits: 0, banked: 0, failed: 0, skipped: 0 },
  };

  const now = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

  function log(msg, kind) {
    S.logs.push({ t: now(), msg, kind: kind || '' });
    if (S.logs.length > 400) S.logs.shift();
    renderLog();
  }

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const stripTags = (h) => String(h ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();

  /* ------------------------------------------------------------------ */
  /* 登录态与接口                                                        */
  /* ------------------------------------------------------------------ */

  function token() {
    const m = document.cookie.match(/(?:^|;\s*)token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function studentStore() {
    try { return JSON.parse(localStorage.getItem('student') || '{}') || {}; } catch (_) { return {}; }
  }

  // 先读 pinia 持久化缓存；缓存没有就退回接口
  let cachedStudentId = '';
  async function resolveStudentId() {
    const local = studentStore()?.studentInfo?.studentid || '';
    if (local) return local;
    if (cachedStudentId) return cachedStudentId;
    const info = await api('/student/sysUser/getUserInfo');
    const sid = info?.studentid || info?.studentInfo?.studentid || '';
    if (!sid) throw new Error('没能取到学号，请在“我的考试”页面运行一次');
    cachedStudentId = sid;
    return sid;
  }

  const pastSemester = () => studentStore()?.semesterConfig?.pastsemester;

  async function api(path, { method = 'GET', body } = {}) {
    const tk = token();
    if (!tk) throw new Error('未登录或登录已过期，请先在本页登录');
    const res = await fetch(API + path, {
      method,
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', token: tk },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) throw new Error('登录已过期（401），请重新登录');
    let json = null;
    try { json = await res.json(); } catch (_) {}
    if (!json) throw new Error(`接口无返回（HTTP ${res.status}）`);
    if (json.errorCode === 501) throw new Error('登录已过期，请重新登录');
    if (json.errorCode !== 200) throw new Error(json.errorMsg || `接口错误 ${json.errorCode}`);
    return json.data;
  }

  async function serverNow() {
    for (const method of ['GET', 'POST']) {
      try {
        const d = await api('/student/commonutil/getServerCurrentTime', { method });
        const n = Number(d);
        if (Number.isFinite(n) && n > 0) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
      } catch (_) { /* 换下一种方法 */ }
    }
    return Math.floor(Date.now() / 1000);
  }

  function listOf(data) {
    if (Array.isArray(data)) return data;
    if (!data) return [];
    return data.records || data.list || data.rows || [];
  }

  async function listExams() {
    const sid = await resolveStudentId();
    const body = { pageNum: 1, pageSize: 9999, studentid: sid, semesters: pastSemester() };
    const rows = listOf(await api('/student/exmExamine/listExamPage', { method: 'POST', body }));
    return rows.map((r) => ({
      kind: 'exam',
      templateno: r.templateno,
      paperId: r.emineidorhworkid,
      relearnid: String(r.relearnid ?? '0'),
      title: [r.examinetitle, r.coursename].filter(Boolean).join(' · ') || `考试 ${r.templateno}`,
      done: Number(r.examnum || 0),
      limit: Number(r.timeslimit || 0),
      underway: Number(r.underway || 0),
      score: r.finalresult,
      isValid: r.isValid,
    }));
  }

  async function listHomework() {
    const sid = await resolveStudentId();
    const courses = listOf(await api('/student/exmHomework/listCourseHomeworkPage', {
      method: 'POST',
      body: { pageNum: 1, pageSize: 9999, studentid: sid, semesters: pastSemester(), semesterflag: 1 },
    }));
    const out = [];
    for (const c of courses) {
      if (S.stop) break;
      const cid = c.courseid ?? c.id;
      if (!cid) continue;
      let items = [];
      try {
        items = listOf(await api('/student/exmHomework/listHomeworkPage', {
          method: 'POST',
          body: {
            pageNum: 1, pageSize: 9999, studentid: sid,
            semesters: pastSemester(), courseid: cid, semesterflag: 1,
          },
        }));
      } catch (_) { continue; }
      items.forEach((h) => {
        out.push({
          kind: 'homework',
          templateno: h.templateno,
          paperId: h.id,
          relearnid: '0',
          title: [h.title || c.coursename, c.coursename].filter(Boolean).join(' · '),
          done: Number(h.worktimes || 0),
          limit: Number(h.maxtimes || 0),
          underway: Number(h.underway || 0),
          score: h.finalresult,
        });
      });
    }
    return out;
  }

  const fetchPaper = async (templateno, paperId, relearnid = '0') => api(
    `/student/exmPapertemplate/getPaperDetail?${new URLSearchParams({ templateno, emineidorhworkid: paperId, relearnid })}`,
  );

  const fetchRule = async (templateno, relearnid = '0') => {
    try {
      return await api(`/student/exmExamine/getExamRule?templateno=${encodeURIComponent(templateno)}&relearnid=${encodeURIComponent(relearnid)}`);
    } catch (_) { return null; }
  };

  const historyList = (kind, paperId, relearnid = '0') => api(
    kind === 'exam'
      ? `/student/studentpaper/listStudentExamPaperById/${paperId}?relearnid=${relearnid}`
      : `/student/studentpaper/listStudentHomeworkPaperById/${paperId}`,
  );

  const historyDetail = (kind, historyId) => api(
    kind === 'exam'
      ? `/student/studentpaper/getStudentPaperById/${historyId}`
      : `/student/studentpaper/getStudentHomeworkPaperById/${historyId}`,
  );

  function submitPaper(kind, ctx, answerlist) {
    return api('/student/exmExamine/submit/paper', {
      method: 'POST',
      body: {
        emineidorhworkid: ctx.paperId,
        templateno: ctx.templateno,
        answerlist,
        handletime: '',
        retakeid: -1,
        type: kind === 'exam' ? TYPE.EXAM : TYPE.HOMEWORK,
        id: ctx.paperId,
        startdatetime: ctx.startdatetime || '',
        relearnid: ctx.relearnid || '0',
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* 试卷结构                                                            */
  /* ------------------------------------------------------------------ */

  function parseOptions(data) {
    let arr = [];
    try {
      arr = Array.isArray(data) ? data : JSON.parse(data || '[]');
    } catch (_) { arr = []; }
    return (Array.isArray(arr) ? arr : []).filter((o) => o && o.value !== undefined);
  }

  const JUDGE_OPTIONS = [
    { name: '正确', value: '1', id: 1, code: '1' },
    { name: '错误', value: '0', id: 0, code: '0' },
  ];

  function normalizePaper(raw) {
    const groups = Array.isArray(raw?.groupblocks) ? raw.groupblocks : [];
    const out = groups.map((g) => ({
      id: g.id,
      title: g.grouptitle || '',
      blocks: (Array.isArray(g.blocks) ? g.blocks : []).map((b) => {
        const base = {
          id: b.id,
          type: Number(b.type),
          title: b.title || '',
          score: b.score,
          standardanswer: b.standardanswer,
          answer: b.answer,
          options: parseOptions(b.optionsdata),
          children: [],
        };
        if (base.type === Q.COMBINE) {
          let kids = Array.isArray(b.questionsArray) ? b.questionsArray : [];
          if (!kids.length) {
            try { kids = JSON.parse(b.questions || '[]'); } catch (_) { kids = []; }
          }
          base.children = kids.map((c, i) => ({
            id: i,
            type: Number(c.type),
            title: c.title || '',
            score: c.score,
            standardanswer: c.standardanswer,
            answer: c.answer,
            options: parseOptions(c.optionsdata),
          }));
        }
        if (base.type === Q.JUDGE && !base.options.length) base.options = JUDGE_OPTIONS;
        return base;
      }),
    }));

    const flat = [];
    out.forEach((g) => g.blocks.forEach((b) => {
      if (b.type === Q.COMBINE) b.children.forEach((c) => flat.push(c));
      else flat.push(b);
    }));

    return {
      title: raw?.title || '',
      totalscore: raw?.totalscore,
      starttime: raw?.starttime,
      startdatetime: raw?.startdatetime ?? raw?.starttime ?? '',
      groups: out,
      flat,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 题库                                                                */
  /* ------------------------------------------------------------------ */

  // 按“题型 + 题干 + 选项”做指纹；题干里的序号/空白已归一
  function qKey(q) {
    const opts = (q.options || []).map((o) => `${o.name}:${stripTags(o.value)}`).join('|');
    const text = `${q.type}::${stripTags(q.title)}::${opts}`;
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return `${q.type}-${h.toString(36)}`;
  }

  async function loadBank() {
    try {
      const got = await chrome.storage.local.get(BANK_KEY);
      S.bank = got[BANK_KEY] || {};
    } catch (_) { S.bank = {}; }
    return S.bank;
  }

  async function saveBank() {
    try { await chrome.storage.local.set({ [BANK_KEY]: S.bank }); } catch (_) {}
  }

  const hasStd = (q) => q.standardanswer !== undefined
    && q.standardanswer !== null
    && String(q.standardanswer).trim() !== '';

  // 统一成：多选 "A,C"（已排序）、判断 "1"/"0"、单选 "A"
  function normalizeStd(q) {
    const raw = String(q.standardanswer).trim();
    if (q.type === Q.MULTIPLE) {
      return raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean).sort().join(',');
    }
    if (q.type === Q.JUDGE) return raw === '1' ? '1' : '0';
    return raw;
  }

  function harvest(paper) {
    let added = 0;
    let updated = 0;
    paper.flat.forEach((q) => {
      if (!OBJECTIVE.has(q.type) || !hasStd(q)) return;
      const key = qKey(q);
      const val = normalizeStd(q);
      const prev = S.bank[key];
      if (!prev) added += 1;
      else if (prev.answer !== val) updated += 1;
      else return;
      S.bank[key] = { type: q.type, answer: val, title: stripTags(q.title).slice(0, 140), at: Date.now() };
    });
    if (added || updated) S.stats.banked += added;
    return { added, updated };
  }

  /* ------------------------------------------------------------------ */
  /* 作答值                                                              */
  /* ------------------------------------------------------------------ */

  function bankAnswer(q) {
    const hit = S.bank[qKey(q)];
    if (!hit) return null;
    if (q.type === Q.MULTIPLE) return hit.answer.split(',').filter(Boolean).sort();
    return hit.answer;
  }

  function stdAnswer(q) {
    const raw = normalizeStd(q);
    if (q.type === Q.MULTIPLE) return raw.split(',').filter(Boolean).sort();
    return raw;
  }

  function randomAnswer(q) {
    const opts = (q.options && q.options.length) ? q.options : (q.type === Q.JUDGE ? JUDGE_OPTIONS : []);
    if (!opts.length) return '';
    if (q.type === Q.JUDGE) return Math.random() < 0.5 ? '1' : '0';
    if (q.type === Q.MULTIPLE) {
      const picked = opts.filter(() => Math.random() < 0.5).map((o) => o.name);
      return (picked.length ? picked : [opts[0].name]).sort();
    }
    return opts[Math.floor(Math.random() * opts.length)].name;
  }

  /**
   * mode: 'bank'  → 题库优先，没有就随机
   *       'truth' → 标准答案优先，其次题库，最后随机
   */
  function resolveAnswer(q, mode) {
    if (!OBJECTIVE.has(q.type)) return '';
    if (mode === 'truth') {
      if (hasStd(q)) return stdAnswer(q);
      const b = bankAnswer(q);
      if (b !== null) return b;
      return randomAnswer(q);
    }
    const b = bankAnswer(q);
    return b !== null ? b : randomAnswer(q);
  }

  // 按站点自己的格式拼 answerlist
  function buildAnswerList(paper, mode) {
    const answerlist = [];
    let fromBank = 0;
    let fromStd = 0;
    let random = 0;
    const covered = new Set();

    const resolve = (q) => {
      const v = resolveAnswer(q, mode);
      if (mode === 'truth' && hasStd(q)) fromStd += 1;
      else if (bankAnswer(q) !== null) fromBank += 1;
      else random += 1;
      covered.add(qKey(q));
      return v;
    };

    paper.groups.forEach((g) => {
      g.blocks.forEach((b) => {
        if (b.type === Q.COMBINE) {
          const kids = b.children.map((c) => {
            const v = resolve(c);
            if (c.type === Q.MULTIPLE) return { id: c.id, value: Array.isArray(v) ? v : [] };
            return { id: c.id, value: v };
          }).filter((k) => (Array.isArray(k.value) ? k.value.length > 0 : Boolean(k.value)));
          if (kids.length) answerlist.push({ id: b.id, value: JSON.stringify(kids) });
          return;
        }
        const v = resolve(b);
        if (b.type === Q.MULTIPLE) {
          const arr = Array.isArray(v) ? v : [];
          if (arr.length) answerlist.push({ id: b.id, value: JSON.stringify(arr) });
        } else if (v) {
          answerlist.push({ id: b.id, value: v });
        }
      });
    });

    return { answerlist, fromBank, fromStd, random };
  }

  function objectiveQuestions(paper) {
    return paper.flat.filter((q) => OBJECTIVE.has(q.type));
  }

  /* ------------------------------------------------------------------ */
  /* 等待批改                                                            */
  /* ------------------------------------------------------------------ */

  async function waitGraded(kind, ctx, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let announced = false;
    while (Date.now() < deadline && !S.stop) {
      let rows = [];
      try { rows = listOf(await historyList(kind, ctx.paperId, ctx.relearnid)); } catch (_) { rows = []; }
      const graded = rows
        .filter((h) => Number(h.issubmit) === 2)
        .sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (graded) {
        try {
          const detail = await historyDetail(kind, graded.id);
          const paper = normalizePaper(detail);
          const objs = objectiveQuestions(paper);
          const got = objs.filter(hasStd).length;
          if (!announced) {
            announced = true;
            log(`已批改，正在取标准答案（${got}/${objs.length} 题有答案）`);
          }
          if (objs.length && got === objs.length) {
            return { paper, historyId: graded.id, detail };
          }
        } catch (_) { /* 还在批改 */ }
      }
      await sleep(4000);
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 单项流程                                                            */
  /* ------------------------------------------------------------------ */

  async function solveOne(item, opts) {
    const ctx = {
      templateno: item.templateno,
      paperId: item.paperId,
      relearnid: item.relearnid || '0',
      startdatetime: '',
    };
    setStatus(`处理中：${item.title}`);
    log(`—— ${item.title} ——`);

    // 1. 打开试卷
    const raw = await fetchPaper(ctx.templateno, ctx.paperId, ctx.relearnid);
    const paper = normalizePaper(raw);
    ctx.startdatetime = paper.startdatetime;
    const objs = objectiveQuestions(paper);
    if (!objs.length) {
      log('没有客观题（可能全是主观题），跳过', 'warn');
      S.stats.skipped += 1;
      return;
    }

    const times = item.limit;
    let left = times === 0 ? Infinity : Math.max(0, times - item.done);
    if (left <= 0) {
      log(`已用完作答次数（${item.done}/${times}），跳过`, 'warn');
      S.stats.skipped += 1;
      return;
    }

    // 2. 先尝试从历史提交里取标准答案
    try {
      const rows = listOf(await historyList(item.kind, ctx.paperId, ctx.relearnid));
      const graded = rows.filter((h) => Number(h.issubmit) === 2)
        .sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (graded) {
        const detail = await historyDetail(item.kind, graded.id);
        const past = normalizePaper(detail);
        const res = harvest(past);
        if (res.added || res.updated) {
          await saveBank();
          log(`从历史记录补题库：新增 ${res.added}，更正 ${res.updated}`);
        }
      }
    } catch (_) { /* 没有历史记录也正常 */ }

    // 3. 还需要等最早交卷时间
    if (item.kind === 'exam') {
      const rule = await fetchRule(ctx.templateno, ctx.relearnid);
      const minMinutes = Number(rule?.minminutes || 0);
      if (minMinutes > 0 && paper.starttime) {
        const readyAt = Number(paper.starttime) + minMinutes * 60;
        let wait = readyAt - await serverNow();
        if (wait > 0) {
          log(`最早交卷时间还有 ${Math.ceil(wait / 60)} 分钟，等待中…`);
          while (wait > 0 && !S.stop) {
            if (wait % 15 === 0) setStatus(`等待交卷时间：剩 ${Math.ceil(wait / 60)} 分钟`);
            await sleep(1000);
            wait -= 1;
          }
          if (S.stop) return;
        }
      }
    }

    // 4. 题库是否已覆盖全部客观题
    const uncovered = objs.filter((q) => {
      if (hasStd(q)) return false;
      return bankAnswer(q) === null;
    });
    const fullyCovered = uncovered.length === 0;

    if (fullyCovered) {
      log(`题库已覆盖全部 ${objs.length} 道客观题，直接作答`);
      const { answerlist, fromBank, fromStd, random } = buildAnswerList(paper, 'truth');
      if (!answerlist.length) { log('没有可提交的答案，跳过', 'warn'); return; }
      log(`提交：题库/答案 ${fromBank + fromStd} 题，随机 ${random} 题`);
      await submitPaper(item.kind, ctx, answerlist);
      S.stats.submits += 1;
      left -= 1;
      log('已提交，等待批改…');
      const graded = await waitGraded(item.kind, ctx, opts.gradeTimeout);
      if (graded) {
        const res = harvest(graded.paper);
        await saveBank();
        const score = graded.detail?.finalresult;
        log(`完成，成绩 ${score ?? '待出'}${res.added ? `，新收录 ${res.added} 题` : ''}`, 'ok');
        setStatus(`完成：${item.title}${score !== undefined ? `（${score} 分）` : ''}`);
      } else {
        log('提交成功，但批改较慢；稍后可再运行一次补收答案', 'warn');
      }
      return;
    }

    // 5. 题库不全：先提交一版（尽量用题库），批改后再提交全对的一版
    if (left < 2) {
      log(`题库还缺 ${uncovered.length} 题，但只剩 ${left} 次作答机会，只能尽量作答`, 'warn');
      const { answerlist } = buildAnswerList(paper, 'truth');
      if (answerlist.length) {
        await submitPaper(item.kind, ctx, answerlist);
        S.stats.submits += 1;
      }
      log('已提交，等待批改后会把标准答案收进题库', 'warn');
      const graded = await waitGraded(item.kind, ctx, opts.gradeTimeout);
      if (graded) {
        const res = harvest(graded.paper);
        await saveBank();
        log(`已收录 ${res.added} 题标准答案，下次可用`, 'ok');
      }
      return;
    }

    log(`题库缺 ${uncovered.length} 题，先提交一版以获取标准答案`);
    const first = buildAnswerList(paper, 'bank');
    if (!first.answerlist.length) { log('没有可提交的答案，跳过', 'warn'); return; }
    log(`第一遍：题库 ${first.fromBank} 题，随机 ${first.random} 题`);
    await submitPaper(item.kind, ctx, first.answerlist);
    S.stats.submits += 1;
    left -= 1;

    const graded = await waitGraded(item.kind, ctx, opts.gradeTimeout);
    if (!graded) {
      log('等待批改超时，未取到标准答案；稍后再运行一次可接着做', 'warn');
      S.stats.failed += 1;
      return;
    }
    const res = harvest(graded.paper);
    await saveBank();
    log(`已收录标准答案：新增 ${res.added} 题，题库共 ${Object.keys(S.bank).length} 题`);

    if (opts.firstOnly) {
      log('已按“只做第一遍”停在取答案，未做第二遍', 'ok');
      return;
    }
    if (left < 1) {
      log('没有剩余作答次数，无法再提交一次', 'warn');
      return;
    }

    log('第二遍：按标准答案重新作答');
    const second = buildAnswerList(graded.paper, 'truth');
    log(`第二遍提交：标准答案 ${second.fromStd} 题，题库 ${second.fromBank} 题，随机 ${second.random} 题`);
    await submitPaper(item.kind, ctx, second.answerlist);
    S.stats.submits += 1;

    const final = await waitGraded(item.kind, ctx, opts.gradeTimeout);
    if (final) {
      harvest(final.paper);
      await saveBank();
      const score = final.detail?.finalresult;
      log(`完成，最终成绩 ${score ?? '待出'} 分`, 'ok');
      setStatus(`完成：${item.title}${score !== undefined ? `（${score} 分）` : ''}`);
    } else {
      log('第二次已提交，成绩稍后可在“查看详情”确认', 'ok');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 批量                                                                */
  /* ------------------------------------------------------------------ */

  async function run(opts) {
    if (S.running) return;
    S.running = true;
    S.stop = false;
    S.logs = [];
    S.stats = { items: 0, submits: 0, banked: 0, failed: 0, skipped: 0 };
    renderLog();
    setBadge('运行中', 'run');
    refreshButtons();

    try {
      await loadBank();
      log(`题库现有 ${Object.keys(S.bank).length} 题`);

      let items = [];
      if (opts.scope !== 'homework') items = items.concat(await listExams());
      if (opts.scope !== 'exam') items = items.concat(await listHomework());

      if (opts.onlyTodo) {
        items = items.filter((it) => {
          if (it.underway === 1) return true;
          if (it.limit > 0 && it.done >= it.limit) return false;
          return true;
        });
      }
      if (!items.length) {
        log('没有需要处理的项目', 'warn');
        setBadge('无任务', 'warn');
        return;
      }
      log(`共 ${items.length} 项待处理`);

      for (const it of items) {
        if (S.stop) break;
        S.stats.items += 1;
        try {
          await solveOne(it, opts);
        } catch (err) {
          S.stats.failed += 1;
          log(`失败：${it.title} — ${err?.message || err}`, 'err');
          if (/登录/.test(String(err?.message || ''))) {
            log('登录已失效，停止运行', 'err');
            break;
          }
        }
        await sleep(1000);
      }

      const done = S.stop ? '已停止' : '全部完成';
      setBadge(done, S.stop ? 'warn' : 'done');
      log(`结束：${S.stats.items} 项，提交 ${S.stats.submits} 次，新收录 ${S.stats.banked} 题，跳过 ${S.stats.skipped}，失败 ${S.stats.failed}`, 'ok');
    } catch (err) {
      log(`运行出错：${err?.message || err}`, 'err');
      setBadge('出错', 'err');
    } finally {
      S.running = false;
      refreshButtons();
    }
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */

  let host = null;
  let shadow = null;
  const ui = {};

  function setBadge(text, kind) {
    if (!ui.badge) return;
    ui.badge.textContent = text;
    ui.badge.className = `badge ${kind || ''}`;
  }

  function setStatus(text) {
    if (ui.status) ui.status.textContent = text;
  }

  function refreshButtons() {
    if (!ui.run) return;
    ui.run.disabled = S.running;
    ui.stop.disabled = !S.running;
    if (ui.scope) ui.scope.disabled = S.running;
  }

  function renderLog() {
    if (!ui.log) return;
    ui.log.innerHTML = S.logs.slice(-150).map((l) => (
      `<div class="line ${l.kind}"><span class="t">${esc(l.t)}</span>${esc(l.msg)}</div>`
    )).join('') || '<div class="line muted">等待开始…</div>';
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function mountUI() {
    if (host) { host.style.display = 'block'; return; }
    document.getElementById(HOST_ID)?.remove();
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:360px;height:430px;';
    (document.body || document.documentElement).appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { display:flex; flex-direction:column; width:100%; height:100%; box-sizing:border-box;
          overflow:hidden; background:linear-gradient(180deg,#22262d,#15181c); color:#e8ecf1;
          border:1px solid rgba(255,255,255,.1); border-radius:14px;
          box-shadow:0 14px 38px rgba(0,0,0,.5);
          font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; }
        .head { display:flex; align-items:center; gap:8px; padding:10px 12px; flex:none;
          background:rgba(255,255,255,.045); border-bottom:1px solid rgba(255,255,255,.06);
          cursor:move; touch-action:none; }
        .logo { width:20px; height:20px; border-radius:6px; flex:none;
          background:linear-gradient(135deg,#409eff,#36cfc9); }
        .title { flex:1; font-size:13px; font-weight:600; }
        .badge { font-size:10px; padding:2px 7px; border-radius:999px;
          background:rgba(255,255,255,.1); color:#aab4c0; }
        .badge.run { background:rgba(64,158,255,.18); color:#6cb6ff; }
        .badge.done { background:rgba(103,194,58,.18); color:#97dd75; }
        .badge.warn { background:rgba(230,162,60,.18); color:#f0b95f; }
        .badge.err { background:rgba(245,108,108,.18); color:#ff8b8b; }
        .icon-btn { width:20px; height:20px; padding:0; flex:none; background:transparent; border:0;
          color:#8a94a0; font-size:15px; line-height:20px; cursor:pointer; border-radius:5px; }
        .icon-btn:hover { background:rgba(255,255,255,.1); color:#fff; }
        .body { flex:1; min-height:0; display:flex; flex-direction:column; padding:10px 12px 11px; gap:8px; }
        .status { font-size:11.5px; color:#d7dde5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .row { display:flex; gap:6px; }
        .row > * { flex:1; }
        select, button.b { padding:6px 8px; border-radius:8px; border:1px solid rgba(255,255,255,.12);
          background:rgba(255,255,255,.06); color:#cfd6df; font:inherit; cursor:pointer; }
        button.b.primary { background:linear-gradient(135deg,#409eff,#2f7fe0); border-color:transparent;
          color:#fff; font-weight:600; }
        button.b.danger { color:#ff9a9a; border-color:rgba(245,108,108,.35); }
        button.b:disabled { opacity:.4; cursor:not-allowed; }
        .opts { display:flex; flex-wrap:wrap; gap:10px; font-size:11px; color:#9aa5b1; }
        .opts label { display:flex; align-items:center; gap:5px; cursor:pointer; }
        .opts input { accent-color:#409eff; margin:0; }
        .log { flex:1; min-height:0; overflow:auto; background:rgba(0,0,0,.25);
          border:1px solid rgba(255,255,255,.07); border-radius:10px; padding:8px;
          font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10.5px; color:#9fb0c2; }
        .log .line { padding:1px 0; word-break:break-all; }
        .log .t { color:#5d6b7a; margin-right:6px; }
        .log .ok { color:#97dd75; }
        .log .warn { color:#f0b95f; }
        .log .err { color:#ff8b8b; }
        .log .muted { color:#5d6b7a; }
        .foot { font-size:10px; color:#5d6b7a; }
      </style>
      <div class="wrap">
        <div class="head">
          <div class="logo"></div>
          <div class="title">考试自动答题</div>
          <span class="badge" id="badge">就绪</span>
          <button class="icon-btn" id="min" title="收起">−</button>
          <button class="icon-btn" id="close" title="关闭">×</button>
        </div>
        <div class="body" id="body">
          <div class="status" id="status">选择范围后点“开始”</div>
          <div class="row">
            <select id="scope">
              <option value="exam">我的考试</option>
              <option value="homework">我的作业</option>
              <option value="all">考试 + 作业</option>
            </select>
            <button class="b primary" id="run">开始</button>
            <button class="b danger" id="stop" disabled>停止</button>
          </div>
          <div class="opts">
            <label><input type="checkbox" id="onlyTodo" checked>只做未完成的</label>
            <label><input type="checkbox" id="firstOnly">只做第一遍（刷答案）</label>
          </div>
          <div class="log" id="log"></div>
          <div class="foot">第一遍取标准答案 → 第二遍按答案作答</div>
        </div>
      </div>`;

    ui.badge = shadow.getElementById('badge');
    ui.status = shadow.getElementById('status');
    ui.log = shadow.getElementById('log');
    ui.run = shadow.getElementById('run');
    ui.stop = shadow.getElementById('stop');
    ui.scope = shadow.getElementById('scope');
    ui.onlyTodo = shadow.getElementById('onlyTodo');
    ui.firstOnly = shadow.getElementById('firstOnly');
    ui.body = shadow.getElementById('body');
    ui.min = shadow.getElementById('min');

    ui.run.addEventListener('click', () => run({
      scope: ui.scope.value,
      onlyTodo: ui.onlyTodo.checked,
      firstOnly: ui.firstOnly.checked,
      gradeTimeout: 8 * 60 * 1000,
    }));
    ui.stop.addEventListener('click', () => {
      S.stop = true;
      log('收到停止指令，正在收尾…', 'warn');
    });

    let collapsed = false;
    ui.min.addEventListener('click', () => {
      collapsed = !collapsed;
      ui.body.style.display = collapsed ? 'none' : 'flex';
      host.style.height = collapsed ? '44px' : '430px';
      ui.min.textContent = collapsed ? '+' : '−';
    });
    shadow.getElementById('close').addEventListener('click', () => {
      if (S.running) { log('运行中，先停止再关闭', 'warn'); return; }
      document.getElementById(HOST_ID)?.remove();
      host = null;
      shadow = null;
    });

    const head = shadow.querySelector('.head');
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.icon-btn')) return;
      const r = host.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const x = Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - host.offsetWidth);
      const y = Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - host.offsetHeight);
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    });
    head.addEventListener('pointerup', () => { drag = null; });

    setBadge('就绪', '');
    renderLog();
    refreshButtons();
  }

  /* ------------------------------------------------------------------ */
  /* 启动：站点任意页面都挂载（作答全走接口，不需要停在考试页）            */
  /* ------------------------------------------------------------------ */

  // 登录页不挂载，避免遮挡登录表单
  const HIDE_RE = /#\/(login|register)\b/i;

  function sync() {
    if (!alive()) return;
    if (HIDE_RE.test(location.hash)) {
      if (host) host.style.display = 'none';
      return;
    }
    mountUI();
  }

  window.addEventListener('hashchange', sync);
  let last = location.hash;
  setInterval(() => {
    if (location.hash !== last) { last = location.hash; sync(); }
  }, 800);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync, { once: true });
  } else {
    sync();
  }

  window.__EXAM_HELPER__ = { run, S, loadBank };
})();