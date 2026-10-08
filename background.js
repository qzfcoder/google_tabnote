const NOTES_KEY = 'tabNotes';
const ARCHIVES_KEY = 'archivedNotes';

async function readStore(key, fallback) {
  const result = await chrome.storage.local.get(key);
  return result[key] || fallback;
}
async function writeStore(key, value) { await chrome.storage.local.set({ [key]: value }); }
async function ensureNote(tabId, tab) {
  const notes = await readStore(NOTES_KEY, {});
  if (!notes[tabId]) {
    notes[tabId] = { id: `tab-${tabId}`, tabId, title: tab?.title || 'New tab', url: tab?.url || '', content: '', createdAt: Date.now(), updatedAt: Date.now() };
    await writeStore(NOTES_KEY, notes);
  }
  return notes[tabId];
}
async function injectCaptureScript(tabId) {
  if (!tabId) return;
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch {}
}

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'tabnote-root', title: 'TabNote', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'tabnote-plain', parentId: 'tabnote-root', title: '摘录选中文字', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'tabnote-quote', parentId: 'tabnote-root', title: '引用选中文字', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'tabnote-highlight', parentId: 'tabnote-root', title: '标记选中文字', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'tabnote-summary', parentId: 'tabnote-root', title: '摘要选中文字', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'tabnote-screenshot', parentId: 'tabnote-root', title: '截图当前页面', contexts: ['all'] });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  createContextMenus();
});
chrome.runtime.onStartup.addListener(createContextMenus);
chrome.tabs.onCreated.addListener((tab) => { if (tab.id) void ensureNote(tab.id, tab); });

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const notes = await readStore(NOTES_KEY, {});
  if (notes[tabId] && !notes[tabId].customTitle) { notes[tabId].title = tab.title || notes[tabId].title; }
  if (notes[tabId]) { notes[tabId].url = tab.url || notes[tabId].url; await writeStore(NOTES_KEY, notes); }
  await injectCaptureScript(tabId);
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const notes = await readStore(NOTES_KEY, {});
  if (notes[tabId] && !notes[tabId].customTitle) notes[tabId].title = tab.title || notes[tabId].title;
  if (notes[tabId]) { notes[tabId].url = tab.url || notes[tabId].url; await writeStore(NOTES_KEY, notes); }
  await injectCaptureScript(tabId);
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const notes = await readStore(NOTES_KEY, {}); const note = notes[tabId]; if (!note) return;
  if (note.content.trim()) { const archives = await readStore(ARCHIVES_KEY, []); archives.unshift({ ...note, id: `archive-${Date.now()}-${tabId}`, tabId: undefined, archivedAt: Date.now(), source: 'tab-closed' }); await writeStore(ARCHIVES_KEY, archives); }
  delete notes[tabId]; await writeStore(NOTES_KEY, notes);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !tab.windowId) return;
  const menuActions = {
    'tabnote-plain': 'plain',
    'tabnote-quote': 'quote',
    'tabnote-highlight': 'highlight',
    'tabnote-summary': 'summary',
    'tabnote-screenshot': 'screenshot'
  };
  const action = menuActions[info.menuItemId];
  if (!action) return;
  const pending = {
    id: crypto.randomUUID(),
    tabId: tab.id,
    action,
    text: info.selectionText || '',
    source: { title: tab.title || '当前页面', url: tab.url || '' },
    createdAt: Date.now()
  };
  await chrome.storage.local.set({ pendingContextAction: pending });
  await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'context-action', ...pending }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'ensure-note') { const tab = await chrome.tabs.get(message.tabId); sendResponse({ note: await ensureNote(message.tabId, tab) }); return; }
    if (message.type === 'inject-capture') { await injectCaptureScript(message.tabId); sendResponse({ ok: true }); return; }
    if (message.type === 'read-selection') {
      const tabId = message.tabId || sender.tab?.id;
      if (!tabId) throw new Error('找不到当前标签页');
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({ text: window.getSelection()?.toString().trim() || '', source: { title: document.title, url: location.href } })
      });
      const result = results?.[0]?.result || { text: '', source: {} };
      sendResponse({ ok: true, requestId: message.requestId, ...result });
      return;
    }
    if (message.type === 'capture-screenshot') {
      const tab = await chrome.tabs.get(message.tabId || sender.tab?.id);
      if (!tab?.windowId) throw new Error('找不到当前标签页窗口');
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      sendResponse({ ok: true, dataUrl });
      return;
    }
    if (message.type === 'selection-offered' || message.type === 'selection-action' || message.type === 'selection-result') {
      if (sender.tab && !message.forwarded) chrome.runtime.sendMessage({ ...message, forwarded: true }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false });
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-side-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
});


