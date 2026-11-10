const msg = document.getElementById('msg');

function show(text, isErr) {
  msg.textContent = text;
  msg.className = 'msg' + (isErr ? ' err' : '');
}

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://hbnun.lsedu.vip/#/course/21/0' });
});

document.getElementById('inject').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) { show('没有找到当前标签页', true); return; }
    if (!/^https:\/\/hbnun\.lsedu\.vip\//.test(tab.url || '')) {
      show('请先切换到课程页再注入', true);
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.getElementById('cap-helper-host')?.remove();
        delete window.__CAP_HELPER_VERSION__;
        delete window.__CAP_HELPER_LOADED__;
      },
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
    show('已注入，回到页面即可看到浮窗');
  } catch (err) {
    show('注入失败：' + (err?.message || err), true);
  }
});
