const msg = document.getElementById('msg');
const BANK_KEY = 'examAnswerBank';

function show(text, isErr) {
  msg.textContent = text;
  msg.className = 'msg' + (isErr ? ' err' : '');
}

const isSite = (url) => /^https:\/\/hbnun\.lsedu\.vip\//.test(url || '');

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectFiles(tab, files) {
  // 先清掉旧实例，让脚本可以重新挂载
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      document.getElementById('cap-helper-host')?.remove();
      document.getElementById('exam-helper-host')?.remove();
      delete window.__CAP_HELPER_VERSION__;
      delete window.__CAP_HELPER_LOADED__;
      delete window.__EXAM_HELPER_VERSION__;
    },
  });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
}

// 注入后再进页面环境确认一次，把真实结果回报给用户，而不是只说“已注入”
async function verify(tab, hostId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (id) => {
      const el = document.getElementById(id);
      return {
        found: !!el,
        hidden: el ? getComputedStyle(el).display === 'none' : false,
        hash: location.hash,
      };
    },
    args: [hostId],
  });
  return result || { found: false };
}

async function injectTo(files, okText, hostId) {
  try {
    const tab = await activeTab();
    if (!tab || !tab.id) { show('没有找到当前标签页', true); return; }
    if (!isSite(tab.url)) { show('请先切换到 hbnun.lsedu.vip 的页面', true); return; }
    await injectFiles(tab, files);

    const r = await verify(tab, hostId);
    if (!r.found) {
      show('脚本已执行，但浮窗没挂上；按 F12 看 Console 的报错', true);
      return;
    }
    if (r.hidden) {
      show(`已注入，但浮窗被隐藏（当前路由 ${r.hash || '#'}）`, true);
      return;
    }
    show(`${okText}（浮窗已在页面右下角）`);
  } catch (err) {
    show('注入失败：' + (err?.message || err), true);
  }
}

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://hbnun.lsedu.vip/#/course/21/0' });
});

document.getElementById('openExam').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://hbnun.lsedu.vip/#/exam' });
});

document.getElementById('inject').addEventListener('click', () => {
  injectTo(['content.js'], '已注入连播脚本', 'cap-helper-host');
});

document.getElementById('injectExam').addEventListener('click', () => {
  injectTo(['exam.js'], '已注入考试助手', 'exam-helper-host');
});

async function refreshBank() {
  const stat = document.getElementById('bankStat');
  try {
    const got = await chrome.storage.local.get(BANK_KEY);
    const bank = got[BANK_KEY] || {};
    const keys = Object.keys(bank);
    const byType = { 1: 0, 2: 0, 3: 0 };
    keys.forEach((k) => {
      const t = bank[k]?.type;
      if (t in byType) byType[t] += 1;
    });
    stat.innerHTML = keys.length
      ? `答案库：<b>${keys.length}</b> 题（单选 ${byType[1]} / 多选 ${byType[2]} / 判断 ${byType[3]}）`
      : '答案库：空（第一遍作答后自动收集）';
  } catch (_) {
    stat.textContent = '答案库：读取失败';
  }
}

document.getElementById('exportBank').addEventListener('click', async () => {
  try {
    const got = await chrome.storage.local.get(BANK_KEY);
    const bank = got[BANK_KEY] || {};
    const blob = new Blob([JSON.stringify(bank, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exam-answer-bank-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    show(`已导出 ${Object.keys(bank).length} 题`);
  } catch (err) {
    show('导出失败：' + (err?.message || err), true);
  }
});

refreshBank();