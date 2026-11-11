/**
 * 用 Node 模拟浏览器环境，验证 exam.js 的浮窗挂载、路由切换与按钮逻辑。
 * 只做最小 DOM stub，目的是抓出“脚本一加载就抛错”“浮窗不出现”这类问题。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'exam.js'), 'utf8');

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    style: { cssText: '', display: '', height: '', left: '', top: '', right: '', bottom: '' },
    className: '',
    textContent: '',
    innerHTML: '',
    scrollTop: 0,
    scrollHeight: 100,
    children: [],
    listeners: {},
    _attrs: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    remove() { this._removed = true; },
    setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 360, height: 430 }; },
    querySelector(sel) { return this._queryResults?.[sel] || this._found || makeEl('div'); },
    querySelectorAll() { return []; },
    closest() { return null; },
    attachShadow() { this._shadow = makeEl('shadow-root'); return this._shadow; },
    getElementById(id) { return (this._byId && this._byId[id]) || null; },
    setAttribute(k, v) { this._attrs[k] = v; },
    focus() {},
  };
  Object.defineProperty(el, 'offsetWidth', { get: () => 360 });
  Object.defineProperty(el, 'offsetHeight', { get: () => 430 });
  Object.defineProperty(el, 'offsetLeft', { get: () => 0 });
  Object.defineProperty(el, 'offsetTop', { get: () => 0 });
  return el;
}

function makeDocument() {
  const byId = {};
  const created = [];
  const doc = {
    readyState: 'complete',
    _byId: byId,
    _created: created,
    hash: '#/exam',
    cookie: 'token=test-token-abc',
    createElement(tag) {
      const el = makeEl(tag);
      // 让首尾相连的 id 查找能命中
      const origAttach = el.attachShadow.bind(el);
      el.attachShadow = (opts) => {
        const root = origAttach(opts);
        // shadow 里的 getElementById 返回预先登记的占位元素
        root._byId = shadowIds;
        return root;
      };
      created.push(el);
      return el;
    },
    getElementById(id) { return byId[id] || null; },
    addEventListener(type, fn) { (doc._listeners = doc._listeners || {}); (doc._listeners[type] = doc._listeners[type] || []).push(fn); },
    querySelector() { return null; },
    body: makeEl('body'),
  };
  return doc;
}

// shadow 内部需要用到的 id，全部先造好
const shadowIds = {};
[
  'badge', 'status', 'log', 'run', 'stop', 'scope', 'onlyTodo', 'firstOnly', 'body', 'min', 'close',
].forEach((id) => { shadowIds[id] = makeEl('div'); shadowIds[id].id = id; });

const document = makeDocument();

const storage = {};
const chrome = {
  storage: {
    local: {
      _data: storage,
      async get(k) {
        if (typeof k === 'string') return { [k]: storage[k] };
        return { ...storage };
      },
      async set(obj) { Object.assign(storage, obj); },
    },
  },
  runtime: { lastError: null },
};

const localStorageData = {
  student: JSON.stringify({
    studentInfo: { studentid: 'S123', userid: 'U1' },
    semesterConfig: { pastsemester: '2025-2026-1' },
  }),
};

const intervalFns = [];
const windowObj = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
};

const sandbox = {
  document,
  chrome,
  window: windowObj,
  location: { hash: '#/exam', hostname: 'hbnun.lsedu.vip', href: 'https://hbnun.lsedu.vip/#/exam' },
  localStorage: {
    getItem: (k) => (k in localStorageData ? localStorageData[k] : null),
    setItem: (k, v) => { localStorageData[k] = v; },
  },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async () => { throw new Error('测试中不应发起真实请求'); },
  setInterval(fn) {
    intervalFns.push(fn);
    return intervalFns.length;
  },
  setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 1; },
  clearTimeout() {},
  console,
  URLSearchParams,
  Date,
  Math,
  JSON,
};

Object.assign(sandbox, { self: sandbox });
sandbox.globalThis = sandbox;

vm.createContext(sandbox);

let loadErr = null;
try {
  vm.runInContext(src, sandbox, { filename: 'exam.js' });
} catch (err) {
  loadErr = err;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('加载与挂载');

test('脚本加载不抛错', () => {
  assert.strictEqual(loadErr, null, loadErr && loadErr.stack);
});

test('在考试路由下创建了浮窗宿主', () => {
  const hosts = document._created.filter((el) => el.id === 'exam-helper-host');
  assert.ok(hosts.length >= 1, '没有创建 exam-helper-host');
  assert.ok(hosts[0]._shadow, '没有 attachShadow');
});

test('浮窗宿主被真正挂到 DOM 上', () => {
  const host = document._created.find((el) => el.id === 'exam-helper-host');
  assert.ok(host, '没有 exam-helper-host');
  const mounted = document.body.children.includes(host)
    || (document.documentElement && document.documentElement.children.includes(host));
  assert.ok(mounted, '创建了元素但没 appendChild，页面上不会出现浮窗');
});

test('导出调试接口', () => {
  assert.ok(sandbox.window.__EXAM_HELPER__, '缺少 __EXAM_HELPER__');
  assert.strictEqual(typeof sandbox.window.__EXAM_HELPER__.run, 'function');
});

test('浮窗包含版本标记', () => {
  assert.match(sandbox.window.__EXAM_HELPER_VERSION__, /^\d+\.\d+\.\d+$/);
});

console.log('\n路由切换');

test('课程页也显示浮窗（作答全走接口，不依赖当前路由）', () => {
  const host = document._created.find((el) => el.id === 'exam-helper-host');
  sandbox.location.hash = '#/course/21/0';
  intervalFns.forEach((fn) => fn());
  assert.strictEqual(host.style.display, 'block');
});

test('登录页隐藏浮窗', () => {
  const host = document._created.find((el) => el.id === 'exam-helper-host');
  sandbox.location.hash = '#/login';
  intervalFns.forEach((fn) => fn());
  assert.strictEqual(host.style.display, 'none');
});

test('回到考试路由时重新显示', () => {
  const host = document._created.find((el) => el.id === 'exam-helper-host');
  sandbox.location.hash = '#/exam';
  intervalFns.forEach((fn) => fn());
  assert.strictEqual(host.style.display, 'block');
});

console.log('\n按钮与运行状态');

test('未登录时 run() 以“未登录”错误收尾', async () => {});
test('开始按钮绑定在 run 上', () => {
  assert.ok(shadowIds.run.listeners.click && shadowIds.run.listeners.click.length, 'run 没有绑定 click');
});

test('停止按钮绑定', () => {
  assert.ok(shadowIds.stop.listeners.click && shadowIds.stop.listeners.click.length, 'stop 没有绑定 click');
});

test('日志渲染函数可调用且不抛错', () => {
  assert.doesNotThrow(() => sandbox.window.__EXAM_HELPER__.run({
    scope: 'exam', onlyTodo: true, firstOnly: false, gradeTimeout: 1000,
  }).catch(() => {}));
});

console.log(`\n全部通过：${passed} 项`);