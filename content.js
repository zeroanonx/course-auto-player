/**
 * 课程自动连播助手
 *
 * 原理：
 *   1. 找到站点播放器里的 <video>，直接把 currentTime 拖到结尾前 0.2 秒；
 *   2. 播放 0.2 秒后触发站点自己的 ended 事件，站点会按它原本的逻辑
 *      调用 saveLearnRecord 记录进度；
 *   3. 默认只完成当前节，记录完成后立即暂停；取消“只完成当前页”后，
 *      监听视频元素/视频地址变化确认切换；若站点没有自动切换，
 *      则自动点击右侧章节列表里的“下一节”。
 *
 * 注意：本脚本不修改站点接口、不伪造请求，只做“解除拖动限制 + 拖动进度条 + 点击下一节”。
 */
(() => {
  'use strict';

  const VERSION = '1.3.0';
  const HOST_ID = 'cap-helper-host';
  // 扩展重新加载后旧 content script 会失效，但页面里的标记仍在。
  // 用版本号 + 代际号允许“重新注入”，并让旧脚本的循环自行退出。
  const GEN = (window.__CAP_HELPER_GEN__ || 0) + 1;
  window.__CAP_HELPER_GEN__ = GEN;
  if (window.__CAP_HELPER_VERSION__ === VERSION) return;
  window.__CAP_HELPER_VERSION__ = VERSION;
  window.__CAP_HELPER_LOADED__ = true;
  const alive = () => window.__CAP_HELPER_GEN__ === GEN;

  const S = {
    running: false,
    paused: false,
    muted: true,
    autoStart: false,
    single: false,
    collapsed: false,
    holdUntil: 0,
    holdTimer: null,
    refreshing: false,
    resume: null,
    token: null,
    done: 0,
    logs: [],
    currentTitle: '',
    lastId: '',
    sameCount: 0,
    badge: '就绪',
    badgeKind: 'idle',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nowTime = () =>
    new Date().toLocaleTimeString('zh-CN', { hour12: false });

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const RESUME_KEY = 'capAutoResume';
  const REFRESH_KEY = 'capAutoRefresh';

  function sessionGet(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }

  function sessionSet(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function sessionDel(key) {
    try { sessionStorage.removeItem(key); } catch (_) {}
  }

  function takeResume() {
    const data = sessionGet(RESUME_KEY);
    if (!data) return null;
    sessionDel(RESUME_KEY);
    if (!data.at || Date.now() - data.at > 3 * 60 * 1000) return null;
    return data;
  }

  function clearRefreshState() {
    sessionDel(REFRESH_KEY);
  }

  // 自动播放/自动连播被拦截时，刷新页面并自动接着学。
  // 连续刷新 4 次仍无法推进时停止，避免无限刷新。
  function autoRefresh(reason, targetId = '') {
    if (S.refreshing) return true;
    const now = Date.now();
    let state = sessionGet(REFRESH_KEY);
    if (!state || !state.firstAt || now - state.firstAt > 5 * 60 * 1000) {
      state = { count: 0, firstAt: now };
    }
    state.count += 1;
    sessionSet(REFRESH_KEY, state);

    if (state.count > 4) {
      log(`已连续刷新 4 次仍被拦截（${reason}），停止自动刷新`, 'err');
      setBadge('需手动', 'err');
      setStatus('自动播放多次被拦截，请手动点一下视频后再点“开始”');
      return false;
    }

    sessionSet(RESUME_KEY, { at: now, targetId, reason, count: state.count });
    S.refreshing = true;
    if (S.token) S.token.cancelled = true;
    S.running = false;
    setBadge('刷新中', 'warn');
    setStatus(`自动播放被拦截，正在刷新继续（第 ${state.count} 次）…`);
    log(`自动播放/连播被拦截（${reason}），1.2 秒后刷新页面继续`, 'warn');
    setTimeout(() => {
      try { location.reload(); } catch (_) {}
    }, 1200);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 页面元素读取                                                        */
  /* ------------------------------------------------------------------ */

  function isCoursePage() {
    return /#\/(course|studySupplement)\/\d+/.test(location.hash);
  }

  function getVideo() {
    const inside = document.querySelector('#ls-player-preview video');
    if (inside) return inside;
    return [...document.querySelectorAll('video')]
      .filter((v) => v.offsetWidth > 120 && v.offsetHeight > 80)
      .sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0] || null;
  }

  function getItems() {
    return [...document.querySelectorAll('[id^="lesson-item-"]')];
  }

  function activeItem() {
    return getItems().find((el) => el.classList.contains('!cursor-default')) || null;
  }

  function itemStatus(el) {
    return [...el.querySelectorAll('span')]
      .map((x) => x.textContent.trim())
      .filter(Boolean)
      .join('')
      .replace(/\s+/g, '');
  }

  function isDoneItem(el) {
    return /已学\s*100\s*%|已完成|已学完/.test(itemStatus(el));
  }

  function itemTitle(el) {
    const raw =
      el.querySelector('[title]')?.getAttribute('title') ||
      el.innerText ||
      el.textContent ||
      '';
    return raw.split('\n')[0].trim() || '当前课时';
  }

  function nextItemAfter(id) {
    const items = getItems();
    let start = items.findIndex((it) => it.id === id);
    if (start < 0) start = items.findIndex((it) => it.classList.contains('!cursor-default'));
    // 只往后找，不在最后一节又绕回前面的课时，避免无限重复最后一节
    for (let i = start + 1; i < items.length; i++) {
      if (!isDoneItem(items[i])) return items[i];
    }
    return null;
  }

  // 章节标题按钮（“第一章 …”“第二章 …”）。折叠的章节不会渲染课时，
  // 所以当前章学完后必须先把下一章展开，才能继续点击其中的课时。
  function chapterHeaders() {
    return [...document.querySelectorAll('button')]
      .filter((b) => /第\s*[一二三四五六七八九十百千0-9]+\s*章/.test(b.innerText || b.textContent || ''));
  }

  function chapterBoxOf(item) {
    let box = item?.parentElement || null;
    while (box && box !== document.body) {
      const btn = [...box.children].find(
        (c) => c.tagName === 'BUTTON' &&
          /第\s*[一二三四五六七八九十百千0-9]+\s*章/.test(c.innerText || c.textContent || '')
      );
      if (btn) return { box, btn };
      box = box.parentElement;
    }
    return null;
  }

  async function expandNextChapter(currentId, token) {
    const current = document.getElementById(currentId) || activeItem();
    let currentBox = chapterBoxOf(current);
    if (!currentBox) return null;

    for (let guard = 0; guard < 20; guard++) {
      if (token.cancelled || !S.running) return null;
      const headers = chapterHeaders();
      const idx = headers.indexOf(currentBox.btn);
      if (idx < 0 || idx + 1 >= headers.length) return null;

      const btn = headers[idx + 1];
      let box = btn.parentElement;
      let items = [...box.querySelectorAll('[id^="lesson-item-"]')];

      if (!items.length) {
        btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await sleep(250);
        btn.click();
        await waitFor(() => {
          const now = [...box.querySelectorAll('[id^="lesson-item-"]')];
          return now.length > 0 ? now : null;
        }, 4000, 150, token);
        items = [...box.querySelectorAll('[id^="lesson-item-"]')];
      }

      const target = items.find((it) => !isDoneItem(it));
      if (target) return target;

      // 这一章已全部学完，继续看下一章
      currentBox = { box, btn };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 解除播放器的拖动限制                                                */
  /* ------------------------------------------------------------------ */

  // 站点的阿里云播放器在“未开始”的课时上会把 disableSeek 设为 true，
  // 一旦检测到 seeking 就会把进度条拉回原位置。这里在页面主世界把
  // disableSeek 固定为 false，保证 currentTime 能真正拖到结尾。
  function pageSeekPatch() {
    if (window.__CAP_SEEK_PATCH__) return;
    window.__CAP_SEEK_PATCH__ = true;

    const relax = (player) => {
      try {
        const opts = player && player._options;
        if (!opts || opts.__capRelaxed) return;
        Object.defineProperty(opts, 'disableSeek', {
          configurable: true,
          get() { return false; },
          set() { /* 忽略站点的 true */ },
        });
        opts.__capRelaxed = true;
      } catch (_) {}
    };

    const relaxExisting = () => {
      const v = document.querySelector('#ls-player-preview video');
      if (v) relax(v.player);
      relax(window['ls-player-preview']);
    };

    const patchCtor = () => {
      const Orig = window.Aliplayer;
      if (!Orig || Orig.__capPatched) return;
      const Patched = function (...args) {
        const p = new Orig(...args);
        relax(p);
        const v = document.querySelector('#ls-player-preview video');
        if (v) relax(v.player);
        return p;
      };
      Patched.prototype = Orig.prototype;
      try { Object.setPrototypeOf(Patched, Orig); } catch (_) {}
      Patched.__capPatched = true;
      window.Aliplayer = Patched;
    };

    patchCtor();
    relaxExisting();
    document.addEventListener('cap-relax-seek', relaxExisting);
    setInterval(() => {
      patchCtor();
      relaxExisting();
    }, 500);
  }

  function injectSeekPatch() {
    if (document.getElementById('cap-seek-patch')) return;
    try {
      const script = document.createElement('script');
      script.id = 'cap-seek-patch';
      script.textContent = '(' + pageSeekPatch.toString() + ')();';
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* 工具                                                               */
  /* ------------------------------------------------------------------ */

  function waitFor(fn, timeout = 10000, interval = 150, token = S.token) {
    return new Promise((resolve) => {
      const begin = Date.now();
      const tick = () => {
        if (!alive() || (token && token.cancelled)) return resolve(null);
        let value = null;
        try { value = fn(); } catch (_) { value = null; }
        if (value) return resolve(value);
        if (Date.now() - begin >= timeout) return resolve(null);
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                 */
  /* ------------------------------------------------------------------ */

  let host = null;
  let shadow = null;
  const ui = {};

  function mountUI() {
    if (host) return;
    // 清掉扩展重载前遗留的旧浮窗
    document.getElementById(HOST_ID)?.remove();
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;left:18px;top:84px;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .cap {
          width: 272px;
          background: linear-gradient(180deg, #22262d 0%, #15181c 100%);
          color: #e8ecf1;
          border: 1px solid rgba(255,255,255,.1);
          border-radius: 14px;
          box-shadow: 0 14px 38px rgba(0,0,0,.5);
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
          font-size: 12px;
          line-height: 1.5;
          user-select: none;
        }
        .cap-head {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 12px;
          background: rgba(255,255,255,.045);
          border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .logo {
          width: 20px; height: 20px; flex: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #409eff, #36cfc9);
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-size: 9px;
        }
        .title { font-size: 13px; font-weight: 600; flex: 1; letter-spacing: .2px; }
        .badge {
          font-size: 10px; padding: 2px 7px; border-radius: 999px;
          background: rgba(255,255,255,.1); color: #aab4c0; flex: none;
        }
        .badge.run { background: rgba(64,158,255,.18); color: #6cb6ff; }
        .badge.ok, .badge.done { background: rgba(103,194,58,.18); color: #97dd75; }
        .badge.warn { background: rgba(230,162,60,.18); color: #f0b95f; }
        .badge.err { background: rgba(245,108,108,.18); color: #ff8b8b; }
        .icon-btn {
          width: 20px; height: 20px; padding: 0; flex: none;
          background: transparent; border: 0; color: #8a94a0;
          font-size: 15px; line-height: 20px; cursor: pointer; border-radius: 5px;
        }
        .icon-btn:hover { background: rgba(255,255,255,.1); color: #fff; }
        .cap-body { padding: 10px 12px 11px; }
        .status {
          font-size: 11.5px; color: #d7dde5;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin-bottom: 3px;
        }
        .meta { font-size: 10.5px; color: #7f8a96; margin-bottom: 9px; }
        .btns { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 6px; }
        button.b {
          padding: 6px 0; border-radius: 8px; border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.06); color: #cfd6df;
          font-size: 11.5px; cursor: pointer; font-family: inherit;
          transition: .15s;
        }
        button.b:hover { background: rgba(255,255,255,.12); }
        button.b:disabled { opacity: .4; cursor: not-allowed; }
        button.b.primary {
          background: linear-gradient(135deg, #409eff, #2f7fe0);
          border-color: transparent; color: #fff; font-weight: 600;
        }
        button.b.primary:hover { filter: brightness(1.08); }
        .opt {
          display: flex; align-items: center; gap: 6px;
          margin-top: 7px; font-size: 11px; color: #9aa5b1; cursor: pointer;
        }
        .opt input { accent-color: #409eff; margin: 0; }
        .log {
          margin-top: 8px; padding-top: 6px;
          border-top: 1px solid rgba(255,255,255,.07);
          max-height: 74px; overflow: hidden;
        }
        .log-line {
          display: flex; gap: 6px;
          font-size: 10.5px; color: #8a95a1; line-height: 1.55;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .log-line span { color: #5c6672; flex: none; font-variant-numeric: tabular-nums; }
        .log-line.ok { color: #97dd75; }
        .log-line.warn { color: #f0b95f; }
        .log-line.err { color: #ff8b8b; }
        .tip { margin-top: 8px; font-size: 9.5px; color: #5f6975; line-height: 1.45; }
      </style>
      <div class="cap">
        <div class="cap-head">
          <div class="logo">▶</div>
          <div class="title">课程自动连播</div>
          <div class="badge" id="badge">就绪</div>
          <button class="icon-btn" id="collapse" title="收起/展开">−</button>
        </div>
        <div class="cap-body" id="body">
          <div class="status" id="status">等待开始</div>
          <div class="meta" id="progress">已完成 0 节</div>
          <div class="btns">
            <button class="b primary" id="start">开始</button>
            <button class="b" id="pause">暂停</button>
            <button class="b" id="stop">停止</button>
          </div>
          <label class="opt"><input type="checkbox" id="mute" checked> 静音播放</label>
          <label class="opt"><input type="checkbox" id="auto"> 进入课程页自动开始</label>
          <label class="opt"><input type="checkbox" id="single"> 只完成当前页（做完就停）</label>
          <div class="log" id="log"></div>
          <div class="tip">原理：拖到结尾触发站点自带保存；默认保存后暂停。</div>
        </div>
      </div>`;

    document.documentElement.appendChild(host);

    for (const id of ['badge', 'body', 'status', 'progress', 'start', 'pause', 'stop', 'mute', 'auto', 'single', 'log', 'collapse']) {
      ui[id] = shadow.getElementById(id);
    }

    ui.start.addEventListener('click', () => {
      if (S.running) { if (S.paused) resumeRun(); return; }
      startRun();
    });
    ui.pause.addEventListener('click', () => {
      if (!S.running) return;
      if (S.paused) resumeRun(); else pauseRun();
    });
    ui.stop.addEventListener('click', stopRun);
    ui.mute.addEventListener('change', () => {
      S.muted = ui.mute.checked;
      const v = getVideo();
      if (v) v.muted = S.muted;
      saveSettings();
    });
    ui.auto.addEventListener('change', () => {
      S.autoStart = ui.auto.checked;
      saveSettings();
    });
    ui.single.addEventListener('change', () => {
      S.single = ui.single.checked;
      saveSettings();
    });
    ui.collapse.addEventListener('click', () => {
      S.collapsed = !S.collapsed;
      ui.body.style.display = S.collapsed ? 'none' : 'block';
      ui.collapse.textContent = S.collapsed ? '+' : '−';
    });

    renderAll();
    loadSettings();
  }

  function setBadge(text, kind = 'idle') {
    S.badge = text;
    S.badgeKind = kind;
    if (ui.badge) {
      ui.badge.textContent = text;
      ui.badge.className = 'badge ' + kind;
    }
  }

  function setStatus(text) {
    if (ui.status) {
      ui.status.textContent = text;
      ui.status.title = text;
    }
  }

  function updateProgress(extra) {
    if (!ui.progress) return;
    const total = getItems().length;
    ui.progress.textContent =
      `已完成 ${S.done} 节` + (total ? ` · 共 ${total} 节` : '') + (extra ? ` · ${extra}` : '');
  }

  function renderLog() {
    if (!ui.log) return;
    ui.log.innerHTML = S.logs
      .map((l) => `<div class="log-line ${l.kind}"><span>${l.time}</span>${esc(l.msg)}</div>`)
      .join('');
  }

  function renderButtons() {
    if (!ui.start) return;
    ui.start.textContent = S.running ? (S.paused ? '继续' : '运行中') : '开始';
    ui.start.disabled = S.running && !S.paused;
    ui.pause.textContent = S.paused ? '继续' : '暂停';
    ui.pause.disabled = !S.running;
    ui.stop.disabled = !S.running;
  }

  function renderAll() {
    setBadge(S.badge, S.badgeKind);
    setStatus(S.running ? (S.paused ? '已暂停，点“继续”恢复' : '运行中…') : '等待开始');
    updateProgress();
    renderLog();
    renderButtons();
    if (ui.mute) ui.mute.checked = S.muted;
    if (ui.auto) ui.auto.checked = S.autoStart;
    if (ui.single) ui.single.checked = S.single;
  }

  function log(msg, kind = 'info') {
    S.logs.unshift({ time: nowTime(), msg, kind });
    if (S.logs.length > 5) S.logs.length = 5;
    renderLog();
    console.log('%c[课程助手]', 'color:#409eff;font-weight:bold', msg);
  }

  /* ------------------------------------------------------------------ */
  /* 设置                                                               */
  /* ------------------------------------------------------------------ */

  function saveSettings() {
    try {
      chrome.storage.local.set({
        capSettings: { muted: S.muted, autoStart: S.autoStart, single: S.single },
      });
    } catch (_) { /* 非扩展环境忽略 */ }
  }

  let settingsLoaded = false;

  function loadSettings() {
    if (settingsLoaded) return;
    settingsLoaded = true;
    const apply = (saved) => {
      if (saved) {
        S.muted = saved.muted !== false;
        S.autoStart = saved.autoStart === true;
        // 默认连续播放全部课时；只有用户主动勾选才只完成当前页
        S.single = saved.single === true;
      }
      if (ui.mute) ui.mute.checked = S.muted;
      if (ui.auto) ui.auto.checked = S.autoStart;
      if (ui.single) ui.single.checked = S.single;
      maybeAutoStart();
    };
    try {
      chrome.storage.local.get({ capSettings: null }, (res) => apply(res?.capSettings));
    } catch (_) {
      apply(null);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 自动化                                                             */
  /* ------------------------------------------------------------------ */

  // “只完成当前页”模式：视频结束后站点可能还会自动切到下一节并播放。
  // 这里在结束后短暂守住播放器（约 30 秒），任何新视频一播放就立刻暂停。
  function engageSingleHold(video) {
    releaseSingleHold();
    S.holdUntil = Date.now() + 30000;
    const pauseCurrent = () => {
      if (!S.holdUntil || Date.now() > S.holdUntil) { releaseSingleHold(); return; }
      const v = getVideo();
      if (!v) return;
      try { v.muted = true; } catch (_) {}
      try { if (!v.paused) v.pause(); } catch (_) {}
    };
    try { video?.pause(); } catch (_) {}
    pauseCurrent();
    S.holdTimer = setInterval(pauseCurrent, 120);

    // 用户自己点课时或视频时立即解除守住，避免影响手动学习
    const releaseOnUserAction = (e) => {
      const el = e.target;
      if (el && el.closest && (el.closest('[id^="lesson-item-"]') || el.closest('video'))) {
        releaseSingleHold();
      }
    };
    document.addEventListener('click', releaseOnUserAction, true);
    S.holdCleanup = () => document.removeEventListener('click', releaseOnUserAction, true);
  }

  function releaseSingleHold() {
    S.holdUntil = 0;
    if (S.holdTimer) { clearInterval(S.holdTimer); S.holdTimer = null; }
    if (S.holdCleanup) { try { S.holdCleanup(); } catch (_) {} S.holdCleanup = null; }
  }

  // 站点可能在 ended 后不久把新视频插入页面并调用 play()，这里捕获 play 事件立即暂停
  document.addEventListener('play', (e) => {
    if (!S.holdUntil || Date.now() > S.holdUntil) return;
    if (e.target instanceof HTMLVideoElement) {
      try { e.target.pause(); } catch (_) {}
    }
  }, true);

  async function playToEnd(firstVideo, token) {
    let video = firstVideo;
    let warned = false;

    for (let round = 0; round < 4; round++) {
      if (!alive() || token.cancelled || !S.running) return null;

      if (!video || !document.contains(video)) {
        video = await waitFor(() => {
          const v = getVideo();
          return v && v.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 1 ? v : null;
        }, round === 0 ? 25000 : 8000, 200, token);
      }
      if (!video) return null;
      if (video.ended) return video;

      const duration = video.duration;
      const target = Math.max(0, duration - 0.2);

      try { document.dispatchEvent(new CustomEvent('cap-relax-seek')); } catch (_) {}
      try { video.muted = S.muted; } catch (_) {}

      try {
        if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
      } catch (_) {}

      await waitFor(() => !video.seeking, 4000, 120, token);
      if (token.cancelled || !S.running) return null;

      // 拖进度条的过程中站点可能销毁并重建播放器，需要重新拿视频元素
      const current = getVideo();
      if (current !== video) {
        video = current;
        await sleep(300);
        continue;
      }

      if (video.ended) return video;

      try {
        await video.play();
      } catch (err) {
        if (!warned) {
          warned = true;
          log('自动播放被拦截，正在自动重试…', 'warn');
        }
        await sleep(500 + round * 400);
        video = getVideo();
        continue;
      }

      const ended = await waitFor(
        () => video.ended || video.currentTime >= duration - 0.05,
        6000, 150, token
      );
      if (ended) return video;

      await sleep(300);
      video = getVideo();
    }

    return null;
  }

  // 刷新恢复时，页面可能仍停在刚学完的那一节；先跳到下一个未完成课时。
  async function skipDoneActive(token) {
    await sleep(500);
    const active = activeItem();
    if (!active || !isDoneItem(active)) return true;

    log(`“${itemTitle(active)}”已完成，自动跳到下一节`, 'info');
    let next = nextItemAfter(active.id);
    if (!next) next = await expandNextChapter(active.id, token);
    if (!next) return false;

    const oldVideo = getVideo();
    const oldSrc = oldVideo ? (oldVideo.currentSrc || oldVideo.src) : '';
    next.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(300);
    next.click();
    await waitFor(() => {
      const v = getVideo();
      if (!v) return null;
      if (v !== oldVideo) return true;
      const src = v.currentSrc || v.src;
      return src && src !== oldSrc ? true : null;
    }, 12000, 250, token);
    return true;
  }

  async function finishOne(token) {
    let firstVideo = null;
    for (let attempt = 0; attempt < 4 && !firstVideo; attempt++) {
      firstVideo = await waitFor(() => {
        const v = getVideo();
        const hasList = getItems().length > 0;
        return v && hasList && v.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 1 ? v : null;
      }, 15000, 200, token);
      if (!firstVideo && S.running && !token.cancelled) {
        log('视频/章节还没加载好，继续等待…', 'warn');
        await sleep(800);
      }
    }

    if (!firstVideo) {
      if (token.cancelled || !S.running) return 'stopped';
      const act = activeItem();
      if (autoRefresh('视频或课时加载超时', act?.id || '')) return 'stopped';
      log('等待视频/章节课时加载超时，已停止', 'err');
      return 'stuck';
    }

    const before = activeItem();
    const beforeId = before ? before.id : '';

    // 防止在某一节上无限重复（站点没切换、点击也没生效时）
    if (beforeId && beforeId === S.lastId) S.sameCount += 1;
    else S.sameCount = 0;
    S.lastId = beforeId;
    if (S.sameCount >= 2) {
      if (autoRefresh('连续停在同一节', beforeId)) return 'stopped';
      log('连续多次停在同一节，已停止', 'err');
      return 'stuck';
    }

    const beforeTitle = before ? itemTitle(before) : '当前课时';
    const beforeSrc = firstVideo.currentSrc || firstVideo.src;
    const index = before ? getItems().indexOf(before) + 1 : 0;

    S.currentTitle = beforeTitle;
    setStatus(`第 ${index || '?'} 节 · ${beforeTitle}`);
    updateProgress(`第 ${index || '?'} / ${getItems().length} 节`);

    const t0 = performance.now();
    const endedVideo = await playToEnd(firstVideo, token);

    if (!endedVideo) {
      if (token.cancelled || !S.running) return 'stopped';
      if (autoRefresh('自动播放被拦截', beforeId)) return 'stopped';
      log('多次尝试后视频仍未播放到结尾，已停止', 'err');
      return 'stuck';
    }

    const used = ((performance.now() - t0) / 1000).toFixed(1);
    log(`第 ${index || '?'} 节播放完成（${used} 秒）`, 'ok');
    clearRefreshState();

    if (S.single) {
      // 立即暂停；站点若自动切到下一节，hold 会在 30 秒内把新视频也暂停
      engageSingleHold(endedVideo);
      return 'single';
    }

    const videoChanged = () => {
      const v = getVideo();
      if (!v) return null;
      if (v !== endedVideo) return 'new-video';
      const src = v.currentSrc || v.src;
      if (src && src !== beforeSrc) return 'new-src';
      return null;
    };

    const autoChanged = () => {
      const now = activeItem();
      if (beforeId && now && now.id === beforeId) return null;
      return videoChanged();
    };

    let next = nextItemAfter(beforeId);
    let switched = await waitFor(autoChanged, next ? 10000 : 2500, 250, token);
    if (switched) return 'ok';
    if (token.cancelled || !S.running) return 'stopped';

    // 当前章最后一节：展开后面的章节并拿到其中的第一节课时
    if (!next) {
      next = await expandNextChapter(beforeId, token);
      if (token.cancelled || !S.running) return 'stopped';
      if (!next) return 'done';
      log(`已展开下一章：${itemTitle(next)}`, 'info');
      await sleep(300);
    }

    // 站点没有自动切换时，点击章节列表里的下一节
    log('站点未自动切换，尝试点击下一节', 'warn');
    if (!next) return 'done';

    next.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(350);
    next.click();

    switched = await waitFor(videoChanged, 10000, 250, token);
    if (switched) return 'ok';

    // 有些情况下站点内部已经指向下一节，但视频没有真正重新加载，
    // 再点同一节不会生效。这里先点另一节把状态岔开，再点目标节。
    if (token.cancelled || !S.running) return 'stopped';
    log('点击下一节未生效，尝试强制切换…', 'warn');
    const items = getItems();
    const targetIdx = items.indexOf(next);
    const other = items[targetIdx > 0 ? targetIdx - 1 : targetIdx + 1];
    if (other) {
      other.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await sleep(250);
      other.click();
      await waitFor(videoChanged, 8000, 250, token);
      if (token.cancelled || !S.running) return 'stopped';
      next.click();
      switched = await waitFor(videoChanged, 10000, 250, token);
      if (switched) return 'ok';
    }

    if (autoRefresh('未能切换到下一节', next?.id || '')) return 'stopped';
    return 'stuck';
  }

  async function runLoop(token) {
    let guard = 0;
    if (S.resume) {
      S.resume = null;
      const ready = await skipDoneActive(token);
      if (!ready) {
        setBadge('已完成', 'done');
        setStatus('全部课时已完成，已暂停 🎉');
        log('检测到全部课时已完成，已暂停 🎉', 'ok');
        clearRefreshState();
        return;
      }
    }
    while (alive() && S.running && !token.cancelled) {
      while (S.paused && S.running) await sleep(250);
      if (!S.running || token.cancelled) break;
      if (!isCoursePage()) { log('已离开课程页，自动停止', 'warn'); break; }
      if (++guard > 100) { log('已连续处理 100 节，自动停止', 'warn'); break; }

      const result = await finishOne(token);

      if (!alive() || !S.running || token.cancelled) break;
      if (result === 'single') {
        S.done += 1;
        updateProgress();
        setBadge('已暂停', 'done');
        setStatus('当前页已完成，已暂停');
        log('当前页已完成，已暂停；取消勾选可继续下一节', 'ok');
        break;
      }
      if (result === 'done') {
        S.done += 1;
        try { getVideo()?.pause(); } catch (_) {}
        updateProgress();
        setBadge('已完成', 'done');
        setStatus('全部课时已完成，已暂停 🎉');
        log('全部课时已完成，已暂停 🎉', 'ok');
        clearRefreshState();
        break;
      }
      if (result === 'stuck') {
        if (S.badgeKind !== 'err') {
          setBadge('已停止', 'err');
          setStatus('未能切换到下一节，已停止');
        }
        break;
      }

      S.done += 1;
      updateProgress();
      await sleep(300);
    }
  }

  function startRun(opts = {}) {
    if (S.running) { if (S.paused) resumeRun(); return; }
    if (!isCoursePage()) { log('请先打开课程播放页再点开始', 'warn'); return; }

    releaseSingleHold();
    S.refreshing = false;
    S.resume = opts.resume || null;
    if (!opts.resume) { clearRefreshState(); sessionDel(RESUME_KEY); }
    S.running = true;
    S.paused = false;
    S.done = 0;
    S.lastId = '';
    S.sameCount = 0;
    S.token = { cancelled: false };
    setBadge('运行中', 'run');
    setStatus('准备开始…');
    updateProgress();
    renderButtons();
    log('开始运行');

    const token = S.token;
    runLoop(token)
      .catch((err) => {
        console.error('[课程助手]', err);
        log('运行出错：' + (err?.message || err), 'err');
        setBadge('出错', 'err');
        setStatus('运行出错，已停止');
      })
      .finally(() => {
        S.running = false;
        S.paused = false;
        if (S.token === token) S.token = null;
        renderButtons();
        if (!S.refreshing && S.badgeKind !== 'done' && S.badgeKind !== 'err') setBadge('已停止', 'idle');
      });
  }

  function pauseRun() {
    S.paused = true;
    getVideo()?.pause();
    setBadge('已暂停', 'warn');
    setStatus('已暂停，点“继续”恢复');
    renderButtons();
  }

  function resumeRun() {
    S.paused = false;
    try { getVideo()?.play(); } catch (_) {}
    setBadge('运行中', 'run');
    setStatus('运行中…');
    renderButtons();
  }

  function stopRun() {
    releaseSingleHold();
    sessionDel(RESUME_KEY);
    clearRefreshState();
    if (!S.running) return;
    S.running = false;
    S.paused = false;
    if (S.token) S.token.cancelled = true;
    S.token = null;
    try { getVideo()?.pause(); } catch (_) {}
    setBadge('已停止', 'idle');
    setStatus('已停止');
    renderButtons();
    log('已手动停止');
  }

  /* ------------------------------------------------------------------ */
  /* 路由 / 启动                                                        */
  /* ------------------------------------------------------------------ */

  let autoStarted = false;

  function maybeAutoStart() {
    if (autoStarted || !isCoursePage()) return;

    const resume = takeResume();
    if (resume) {
      autoStarted = true;
      log(`检测到上次被拦截（${resume.reason || '自动播放'}），3 秒后继续`, 'warn');
      setTimeout(() => {
        if (!S.running && isCoursePage()) startRun({ resume });
      }, 3000);
      return;
    }

    if (!S.autoStart) return;
    autoStarted = true;
    log('已开启“进入课程页自动开始”，2 秒后启动');
    setTimeout(() => { if (!S.running && isCoursePage()) startRun(); }, 2000);
  }

  function syncRoute() {
    if (isCoursePage()) {
      injectSeekPatch();
      mountUI();
      host.style.display = 'block';
      updateProgress();
      maybeAutoStart();
    } else {
      if (S.running) stopRun();
      if (host) host.style.display = 'none';
    }
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      syncRoute();
    }
  }, 800);
  window.addEventListener('hashchange', () => {
    lastHref = location.href;
    syncRoute();
  });

  function boot() {
    if (isCoursePage()) {
      injectSeekPatch();
      mountUI();
      loadSettings();
      log('插件已加载，点“开始”即可自动连播');
    } else {
      // 不在课程页也加载设置，方便用户提前打开“自动开始”
      try {
        chrome.storage.local.get({ capSettings: null }, (res) => {
          if (res?.capSettings) {
            S.muted = res.capSettings.muted !== false;
            S.autoStart = res.capSettings.autoStart === true;
          }
        });
      } catch (_) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
