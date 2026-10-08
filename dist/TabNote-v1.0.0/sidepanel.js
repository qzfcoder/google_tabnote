const NOTES_KEY = 'tabNotes';
const ARCHIVES_KEY = 'archivedNotes';
const IMAGE_DB = 'tabMarkdownImages';
const DEFAULT_CAPTURE_TEMPLATE = '{{text}}\n\n> 摘录自：[{{title}}]({{url}})';

let activeTab;
let activeNote;
let activeNoteType = 'tab';
let activeArchiveId = null;
let loadVersion = 0;
let saveTimer;
const previewImageUrls = new Set();
let captureTemplate = DEFAULT_CAPTURE_TEMPLATE;
let exportContext = { type: 'current' };

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const visualEditor = $('visualEditor');

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function renderMarkdown(markdown) {
  let html = escapeHtml(markdown || '')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/!\[([^\]]*)\]\((data:image\/[^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/!\[([^\]]*)\]\(tabmd-image:([a-zA-Z0-9-]+)\)/g, '<img data-image-id="$2" alt="$1">');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  return html.split(/\n{2,}/).map((block) => {
    if (/^<(h[1-3]|blockquote|ul|img)/.test(block.trim())) return block;
    return block ? `<p>${block.replace(/\n/g, '<br>')}</p>` : '';
  }).join('');
}

function openImageDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeBlob(blob) {
  const db = await openImageDb();
  const id = crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('images', 'readwrite');
    transaction.objectStore('images').put({ id, blob, createdAt: Date.now() });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return id;
}

async function storeImage(dataUrl) {
  return storeBlob(await (await fetch(dataUrl)).blob());
}

async function readImage(id) {
  const db = await openImageDb();
  const record = await new Promise((resolve, reject) => {
    const request = db.transaction('images', 'readonly').objectStore('images').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return record?.blob;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function renderStoredImages(container) {
  for (const url of previewImageUrls) URL.revokeObjectURL(url);
  previewImageUrls.clear();
  const images = [...container.querySelectorAll('[data-image-id]')];
  await Promise.all(images.map(async (image) => {
    const blob = await readImage(image.dataset.imageId).catch(() => null);
    if (!blob || !image.isConnected) return;
    const url = URL.createObjectURL(blob);
    previewImageUrls.add(url);
    image.src = url;
  }));
}

function nodeToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node;
  const tag = element.tagName.toLowerCase();
  if (tag === 'img') {
    const source = element.dataset.imageId ? `tabmd-image:${element.dataset.imageId}` : element.getAttribute('src') || '';
    return source ? `![${element.getAttribute('alt') || '图片'}](${source})` : '';
  }
  if (tag === 'br') return '\n';
  const content = [...element.childNodes].map(nodeToMarkdown).join('');
  if (tag === 'h1') return `# ${content}`;
  if (tag === 'h2') return `## ${content}`;
  if (tag === 'h3') return `### ${content}`;
  if (tag === 'blockquote') return content.split('\n').map((line) => `> ${line}`).join('\n');
  if (tag === 'li') return `- ${content}`;
  if (tag === 'mark') return `==${content}==`;
  if (tag === 'code') return `\`${content}\``;
  if (tag === 'strong' || tag === 'b') return `**${content}**`;
  if (tag === 'em' || tag === 'i') return `*${content}*`;
  return content;
}

function htmlToMarkdown(root) {
  return [...root.childNodes]
    .map(nodeToMarkdown)
    .map((block) => block.trimEnd())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

async function refreshVisualEditor() {
  if (!visualEditor) return;
  visualEditor.innerHTML = renderMarkdown(editor.value);
  await renderStoredImages(visualEditor);
}

function updateView() {
  const content = editor.value;
  $('preview').innerHTML = renderMarkdown(content);
  if (!$('preview').classList.contains('hidden')) void renderStoredImages($('preview'));
  if (visualEditor && !visualEditor.classList.contains('hidden') && document.activeElement !== visualEditor) void refreshVisualEditor();
  $('emptyState').classList.toggle('hidden', Boolean(content.trim()) || !$('editModeButton').classList.contains('active'));
  $('wordCount').textContent = `${content.replace(/\s/g, '').length} 字`;
  $('updatedAt').textContent = activeNote?.updatedAt ? `更新于 ${formatTime(activeNote.updatedAt)}` : '尚未编辑';
}

function getCaptureMode() {
  return 'quote';
}

function shouldAppendSource() {
  return true;
}

function updateNoteContext() {
  const switcher = $('noteSwitcher');
  if (switcher) switcher.value = activeNoteType === 'archive' ? 'archive:' + activeArchiveId : 'tab:' + activeTab?.id;
  $('tabUrl').textContent = activeNote?.url || activeTab?.url || '本地笔记';
  $('saveState').textContent = activeNoteType === 'archive' ? '归档笔记' : '本地保存';
}

async function populateNoteSwitcher() {
  const switcher = $('noteSwitcher');
  if (!switcher) return;
  const result = await chrome.storage.local.get(ARCHIVES_KEY);
  const archives = result[ARCHIVES_KEY] || [];
  switcher.replaceChildren();
  if (activeTab?.id) {
    const option = document.createElement('option');
    option.value = 'tab:' + activeTab.id;
    option.textContent = '当前笔记 · ' + (activeNote?.title || activeTab.title || '新标签页');
    switcher.appendChild(option);
  }
  archives.forEach((note) => {
    const option = document.createElement('option');
    option.value = 'archive:' + note.id;
    option.textContent = '笔记库 · ' + (note.title || '未命名笔记');
    switcher.appendChild(option);
  });
  updateNoteContext();
}

async function loadArchiveNote(id) {
  const result = await chrome.storage.local.get(ARCHIVES_KEY);
  const note = (result[ARCHIVES_KEY] || []).find((item) => item.id === id);
  if (!note) { showToast('找不到这条归档笔记'); return; }
  clearTimeout(saveTimer);
  activeNoteType = 'archive';
  activeArchiveId = id;
  activeNote = { ...note };
  editor.value = note.content || '';
  $('tabUrl').textContent = note.url || '来自笔记库';
  $('saveState').textContent = '归档笔记';
  $('editModeButton').click();
  await populateNoteSwitcher();
}

async function saveArchiveSnapshot(id, content, metadata) {
  const result = await chrome.storage.local.get(ARCHIVES_KEY);
  const archives = result[ARCHIVES_KEY] || [];
  const index = archives.findIndex((note) => note.id === id);
  if (index < 0) return;
  archives[index] = { ...archives[index], ...metadata, content, updatedAt: Date.now() };
  await chrome.storage.local.set({ [ARCHIVES_KEY]: archives });
  if (activeNoteType === 'archive' && activeArchiveId === id) {
    activeNote = archives[index];
    $('saveState').textContent = '已保存';
    updateView();
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadNote() {
  const version = ++loadVersion;
  clearTimeout(saveTimer);
  const tab = await getActiveTab();
  if (!tab?.id || version !== loadVersion) return;
  activeTab = tab;
  activeNoteType = 'tab';
  activeArchiveId = null;
  const response = await chrome.runtime.sendMessage({ type: 'ensure-note', tabId: tab.id });
  if (version !== loadVersion || !response?.note) return;
  activeNote = response.note;
  const templateResult = await chrome.storage.local.get('captureTemplate');
  if (templateResult.captureTemplate) captureTemplate = templateResult.captureTemplate;
  $('tabUrl').textContent = tab.url || '浏览器新标签页';
  editor.value = activeNote.content || '';
  await populateNoteSwitcher();
  updateView();
  document.getElementById('editModeButton').click();
  await chrome.runtime.sendMessage({ type: 'inject-capture', tabId: tab.id });
  await consumePendingContextAction(tab.id);
}
async function saveSnapshot(tabId, content, metadata) {
  if (!tabId) return;
  const result = await chrome.storage.local.get(NOTES_KEY);
  const notes = result[NOTES_KEY] || {};
  const saved = { ...notes[tabId], ...metadata, tabId, content, updatedAt: Date.now() };
  notes[tabId] = saved;
  await chrome.storage.local.set({ [NOTES_KEY]: notes });
  if (activeNote?.tabId === tabId) {
    activeNote = saved;
    $('saveState').textContent = '已保存';
    updateView();
  }
}

async function saveNote() {
  if (activeNoteType === 'archive') {
    if (activeArchiveId) await saveArchiveSnapshot(activeArchiveId, editor.value, activeNote);
    return;
  }
  if (activeNote?.tabId) await saveSnapshot(activeNote.tabId, editor.value, activeNote);
}

function scheduleSave() {
  $('saveState').textContent = '保存中…';
  clearTimeout(saveTimer);
  const content = editor.value;
  const metadata = { ...activeNote };
  const saveType = activeNoteType;
  const saveArchiveId = activeArchiveId;
  const saveTabId = activeNote?.tabId;
  saveTimer = setTimeout(() => {
    if (saveType === 'archive') return saveArchiveSnapshot(saveArchiveId, content, metadata);
    return saveSnapshot(saveTabId, content, metadata);
  }, 250);
}

async function renameCurrentNote() {
  if (!activeNote) return;
  const title = prompt('输入新的笔记名称', activeNote.title || '未命名笔记');
  if (!title?.trim()) return;
  activeNote.title = title.trim();
  activeNote.customTitle = true;
  if (activeNoteType === 'archive') await saveArchiveSnapshot(activeArchiveId, editor.value, activeNote);
  else await saveSnapshot(activeNote.tabId, editor.value, activeNote);
  await populateNoteSwitcher();
  showToast('笔记名称已修改');
}

function appendCapture(text, source, mode = getCaptureMode()) {
  if (!text?.trim()) {
    showToast('请先在网页中选中文字');
    return;
  }
  const cleaned = text.trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  const title = source?.title || activeTab?.title || '当前页面';
  const url = source?.url || activeTab?.url || '';
  let rendered = cleaned;
  if (mode === 'plain' && captureTemplate !== DEFAULT_CAPTURE_TEMPLATE) {
    rendered = captureTemplate
      .replaceAll('{{text}}', cleaned)
      .replaceAll('{{title}}', title)
      .replaceAll('{{url}}', url);
  }
  if (mode === 'quote') rendered = cleaned.split('\n').map((line) => `> ${line}`).join('\n');
  if (mode === 'highlight') rendered = `==${cleaned.replace(/\n/g, ' ')}==`;
  if (shouldAppendSource()) {
    const sourceLine = `\n\n> 来源：[${title}](${url})`;
    rendered += sourceLine;
  }
  editor.value = `${editor.value.trimEnd()}${editor.value.trim() ? '\n\n' : ''}${rendered}\n`;
  updateView();
  scheduleSave();
  showToast(mode === 'highlight' ? '已添加黄色标记' : mode === 'quote' ? '已添加引用块' : '已添加摘录');
}

async function captureSelection() {
  if (!activeTab?.id) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'read-selection', tabId: activeTab.id });
    if (!response?.ok) throw new Error(response?.error || '读取选区失败');
    appendCapture(response.text, response.source, getCaptureMode());
  } catch (error) {
    showToast(error.message || '当前页面不支持摘录');
  }
}

function summarizeText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const sentences = normalized.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
  if (sentences.length <= 3 && normalized.length <= 360) return normalized;
  const selected = sentences.slice(0, 3).join(' ');
  return selected.length > 360 ? selected.slice(0, 357) + '…' : selected;
}

function appendSummary(text, source) {
  const summary = summarizeText(text);
  if (!summary) {
    showToast('请先选中文字，或在笔记中写入内容');
    return false;
  }
  const rendered = '## 摘要\n\n' + summary + '\n\n> 摘要来源：[' + (source?.title || '当前页面') + '](' + (source?.url || '') + ')';
  editor.value = editor.value.trimEnd() + (editor.value.trim() ? '\n\n' : '') + rendered + '\n';
  updateView();
  scheduleSave();
  showToast('已生成本地摘要');
  return true;
}

async function summarizeCurrent() {
  let text = '';
  let source = { title: activeTab?.title || '当前笔记', url: activeTab?.url || '' };
  try {
    if (activeTab?.id) {
      const response = await chrome.runtime.sendMessage({ type: 'read-selection', tabId: activeTab.id });
      if (response?.ok && response.text) { text = response.text; source = response.source || source; }
    }
  } catch {}
  if (!text) text = editor.value.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^> 来源:.*$/gm, '').trim();
  appendSummary(text, source);
}

async function insertImageDataUrl(dataUrl, alt, message = '图片已插入笔记') {
  if (!dataUrl?.startsWith('data:image/')) return false;
  editor.value = editor.value.trimEnd() + (editor.value.trim() ? '\n\n' : '') + '![' + alt + '](' + dataUrl + ')\n';
  updateView();
  scheduleSave();
  if (visualEditor && !visualEditor.classList.contains('hidden')) void refreshVisualEditor();
  showToast(message);
  return true;
}

async function insertImageBlob(blob, alt = '粘贴图片') {
  if (!blob?.type?.startsWith('image/')) return false;
  return insertImageDataUrl(await blobToDataUrl(blob), alt);
}

async function getClipboardImage(event) {
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
  const imageFile = imageItem?.getAsFile();
  if (imageFile) return imageFile;

  const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
  if (file) return file;

  const html = event.clipboardData?.getData('text/html') || '';
  const htmlDocument = new DOMParser().parseFromString(html, 'text/html');
  const source = htmlDocument.querySelector('img')?.getAttribute('src') || '';
  if (!source.startsWith('data:image/')) return null;
  return (await fetch(source)).blob();
}

function downloadFile(filename, content, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function safeFilename(value, fallback = 'tab-note') {
  return (String(value || fallback).replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 70) || fallback);
}

async function inlineImages(markdown) {
  let result = markdown;
  const markers = [...markdown.matchAll(/!\[([^\]]*)\]\(tabmd-image:([a-zA-Z0-9-]+)\)/g)];
  for (const [marker, alt, id] of markers) {
    const blob = await readImage(id);
    const replacement = blob ? `![${alt}](${await blobToDataUrl(blob)})` : '';
    result = result.replace(marker, replacement);
  }
  return result;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function makeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    writeU32(localView, 0, 0x04034b50); writeU16(localView, 4, 20); writeU16(localView, 6, 0x0800); writeU16(localView, 8, 0);
    writeU16(localView, 10, 0); writeU16(localView, 12, 0); writeU32(localView, 14, crc); writeU32(localView, 18, data.length); writeU32(localView, 22, data.length);
    writeU16(localView, 26, name.length); writeU16(localView, 28, 0); local.set(name, 30); localParts.push(local, data);
    const central = new Uint8Array(46 + name.length); const centralView = new DataView(central.buffer);
    writeU32(centralView, 0, 0x02014b50); writeU16(centralView, 4, 20); writeU16(centralView, 6, 20); writeU16(centralView, 8, 0x0800); writeU16(centralView, 10, 0); writeU16(centralView, 12, 0); writeU16(centralView, 14, 0); writeU32(centralView, 16, crc); writeU32(centralView, 20, data.length); writeU32(centralView, 24, data.length); writeU16(centralView, 28, name.length); writeU16(centralView, 30, 0); writeU16(centralView, 32, 0); writeU16(centralView, 34, 0); writeU16(centralView, 36, 0); writeU32(centralView, 38, 0); writeU32(centralView, 42, offset); central.set(name, 46); centralParts.push(central); offset += local.length + data.length;
  }
  const local = concatBytes(localParts); const central = concatBytes(centralParts); const end = new Uint8Array(22); const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50); writeU16(endView, 4, 0); writeU16(endView, 6, 0); writeU16(endView, 8, files.length); writeU16(endView, 10, files.length); writeU32(endView, 12, central.length); writeU32(endView, 16, local.length); writeU16(endView, 20, 0);
  return new Blob([local, central, end], { type: 'application/zip' });
}
async function exportZip(title) {
  const encoder = new TextEncoder(); const files = []; let markdown = editor.value;
  const markers = [...markdown.matchAll(/!\[([^\]]*)\]\(tabmd-image:([a-zA-Z0-9-]+)\)/g)];
  for (const [marker, alt, id] of markers) {
    const blob = await readImage(id); if (!blob) continue;
    const filename = `images/${id}.png`; markdown = markdown.replace(marker, `![${alt}](${filename})`);
    files.push({ name: filename, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  files.unshift({ name: `${title}.md`, data: encoder.encode(markdown) });
  const url = URL.createObjectURL(makeZip(files)); const link = document.createElement('a'); link.href = url; link.download = `${title}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function exportArchiveZip(notes, title) {
  const encoder = new TextEncoder();
  const files = [];
  for (const [index, note] of notes.entries()) {
    const prefix = `${String(index + 1).padStart(2, '0')}-${safeFilename(note.title, '未命名笔记')}`;
    let markdown = note.content || '';
    const markers = [...markdown.matchAll(/!\[([^\]]*)\]\(tabmd-image:([a-zA-Z0-9-]+)\)/g)];
    for (const [marker, alt, id] of markers) {
      const blob = await readImage(id);
      if (!blob) continue;
      const extension = blob.type?.split('/')[1] || 'png';
      const filename = `images/${prefix}-${id}.${extension}`;
      markdown = markdown.replace(marker, `![${alt}](${filename})`);
      files.push({ name: filename, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    files.unshift({ name: `${prefix}.md`, data: encoder.encode(`# ${note.title || '未命名笔记'}\n\n${markdown}`) });
  }
  const url = URL.createObjectURL(makeZip(files));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
async function exportMarkdown() {
  const title = (activeNote?.title || 'tab-note').replace(/[\\/:*?"<>|]/g, '-').slice(0, 70) || 'tab-note';
  await exportNote('markdown', title);
}

function markdownToHtml(markdown) {
  let html = escapeHtml(markdown || '')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/!\[([^\]]*)\]\((data:image\/[^)]+)\)/g, '<img src="$2" alt="$1">');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  return html.split(/\n{2,}/).map((block) => {
    if (/^<(h[1-3]|blockquote|ul|img)/.test(block.trim())) return block;
    return block ? `<p>${block.replace(/\n/g, '<br>')}</p>` : '';
  }).join('');
}

function printableHtml(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{max-width:800px;margin:42px auto;padding:0 36px;color:#17202b;font:15px/1.8 Arial,sans-serif}h1,h2,h3{font-family:Georgia,serif;line-height:1.25}h1{font-size:30px}h2{font-size:23px}blockquote{margin:14px 0;padding:8px 15px;border-left:4px solid #e45d45;background:#fcedea;color:#56606b}mark{padding:0 3px;background:#ffe49a}code{padding:2px 4px;background:#f0f1ed;border-radius:4px}img{display:block;max-width:100%;height:auto;margin:14px 0;border:1px solid #e3e5df;border-radius:8px}small{color:#7c858e}</style></head><body><h1>${escapeHtml(title)}</h1>${body}<p><small>由 TabNote 本地生成 · ${new Date().toLocaleString('zh-CN')}</small></p></body></html>`;
}

async function exportWord(title) {
  const markdown = await inlineImages(editor.value);
  downloadFile(`${title}.doc`, printableHtml(title, markdownToHtml(markdown)), 'application/msword');
  showToast('Word 兼容文档已导出');
}

async function exportPdf(title) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { showToast('请允许插件打开打印页面'); return; }
  const markdown = await inlineImages(editor.value);
  printWindow.document.open();
  printWindow.document.write(printableHtml(title, markdownToHtml(markdown)));
  printWindow.document.close();
  printWindow.onload = () => printWindow.print();
  setTimeout(() => { try { printWindow.print(); } catch {} }, 500);
  showToast('已打开打印面板，请选择另存为 PDF');
}

async function exportNote(format, title) {
  $('exportModal').classList.add('hidden');
  if (format === 'zip') { await exportZip(title); showToast('ZIP 笔记包已导出'); return; }
  if (format === 'word') { await exportWord(title); return; }
  if (format === 'pdf') { await exportPdf(title); return; }
  const markdown = format === 'markdown'
    ? editor.value.replace(/!\[[^\]]*\]\((?:tabmd-image:[a-zA-Z0-9-]+|data:image\/[^)]+)\)/g, '')
    : await inlineImages(editor.value);
  downloadFile(`${title}.md`, markdown);
  showToast(format === 'markdown' ? '纯文本 Markdown 已导出' : '带图片 Markdown 已导出');
}

async function exportSelectedArchives(format, ids) {
  const result = await chrome.storage.local.get(ARCHIVES_KEY);
  const selected = (result[ARCHIVES_KEY] || []).filter((note) => ids.includes(note.id));
  if (!selected.length) { showToast('请先选择归档笔记'); return; }
  $('exportModal').classList.add('hidden');
  const title = `归档笔记-${selected.length}篇`;
  if (format === 'zip') {
    await exportArchiveZip(selected, title);
    showToast(`已导出 ${selected.length} 条笔记 ZIP`);
    return;
  }
  const sections = [];
  for (const note of selected) {
    let markdown = note.content || '';
    markdown = format === 'markdown'
      ? markdown.replace(/!\[[^\]]*\]\(tabmd-image:[a-zA-Z0-9-]+\)/g, '')
      : await inlineImages(markdown);
    sections.push(`# ${note.title || '未命名笔记'}\n\n${markdown}`);
  }
  const mergedMarkdown = sections.join('\n\n---\n\n');
  if (format === 'word') {
    downloadFile(`${title}.doc`, printableHtml(title, markdownToHtml(mergedMarkdown)), 'application/msword');
    showToast(`已导出 ${selected.length} 条笔记 Word`);
    return;
  }
  if (format === 'pdf') {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { showToast('请允许插件打开打印页面'); return; }
    printWindow.document.open();
    printWindow.document.write(printableHtml(title, markdownToHtml(mergedMarkdown)));
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
    setTimeout(() => { try { printWindow.print(); } catch {} }, 500);
    showToast(`已打开 ${selected.length} 条笔记的 PDF 打印面板`);
    return;
  }
  downloadFile(`${title}.md`, mergedMarkdown);
  showToast(`已导出 ${selected.length} 条笔记 Markdown`);
}
async function archiveCurrent() {
  if (!activeNote || !editor.value.trim()) {
    showToast('当前笔记没有内容');
    return;
  }
  const result = await chrome.storage.local.get(ARCHIVES_KEY);
  const archives = result[ARCHIVES_KEY] || [];
  archives.unshift({ ...activeNote, content: editor.value, id: `archive-${Date.now()}`, archivedAt: Date.now(), source: 'manual' });
  await chrome.storage.local.set({ [ARCHIVES_KEY]: archives });
  showToast('已保存到全局笔记库');
  renderArchives();
}

async function deleteArchive(id) {
  if (!confirm('确定删除这条归档笔记吗？')) return;
  const result = await chrome.storage.local.get(ARCHIVES_KEY);
  const archives = (result[ARCHIVES_KEY] || []).filter((note) => note.id !== id);
  await chrome.storage.local.set({ [ARCHIVES_KEY]: archives });
  renderArchives();
  showToast('归档笔记已删除');
}

async function renameArchive(id) {
  const result = await chrome.storage.local.get(ARCHIVES_KEY);
  const archives = result[ARCHIVES_KEY] || [];
  const note = archives.find((item) => item.id === id);
  if (!note) return;
  const title = prompt('输入新的笔记标题', note.title || '未命名笔记');
  if (!title?.trim()) return;
  note.title = title.trim();
  note.customTitle = true;
  await chrome.storage.local.set({ [ARCHIVES_KEY]: archives });
  if (activeNoteType === 'archive' && activeArchiveId === id) activeNote = { ...note };
  renderArchives();
  await populateNoteSwitcher();
  updateView();
  showToast('笔记名称已修改');
}

async function editCaptureTemplate() {
  const template = prompt('编辑摘录模板。可用变量：{{text}} 原文、{{title}} 网页标题、{{url}} 网页链接。示例：\n## {{title}}\n\n{{text}}\n\n来源：{{url}}', captureTemplate);
  if (template === null) return;
  captureTemplate = template;
  await chrome.storage.local.set({ captureTemplate });
  showToast('模板已保存，选择“纯文字”摘录时生效');
}
async function deleteSelectedArchives() {
  const selected = [...$('archiveList').querySelectorAll('.archive-select:checked')].map((input) => input.closest('.archive-card')?.dataset.id).filter(Boolean);
  if (!selected.length) { showToast('请先选择归档笔记'); return; }
  if (!confirm(`确定删除选中的 ${selected.length} 条笔记吗？`)) return;
  const result = await chrome.storage.local.get(ARCHIVES_KEY);
  const archives = (result[ARCHIVES_KEY] || []).filter((note) => !selected.includes(note.id));
  await chrome.storage.local.set({ [ARCHIVES_KEY]: archives });
  $('selectAllArchives').checked = false;
  renderArchives();
  showToast(`已删除 ${selected.length} 条笔记`);
}

function getSelectedArchiveIds() {
  return [...$('archiveList').querySelectorAll('.archive-select:checked')]
    .map((input) => input.closest('.archive-card')?.dataset.id)
    .filter(Boolean);
}

function updateArchiveSelection() {
  const inputs = [...$('archiveList').querySelectorAll('.archive-select')];
  const selectedCount = inputs.filter((input) => input.checked).length;
  $('archiveSelectionCount').textContent = selectedCount ? `已选 ${selectedCount} 条` : '未选择';
  $('exportSelectedArchives').disabled = selectedCount === 0;
  $('selectAllArchives').checked = inputs.length > 0 && selectedCount === inputs.length;
  $('selectAllArchives').indeterminate = selectedCount > 0 && selectedCount < inputs.length;
}
async function clearCurrent() {
  if (!editor.value.trim() || !confirm('确定清空当前笔记的全部内容吗？')) return;
  editor.value = '';
  await saveNote();
  showToast('当前笔记已清空');
}

async function renderArchives() {
  const result = await chrome.storage.local.get(ARCHIVES_KEY);
  const query = $('searchInput').value.trim().toLowerCase();
  const archives = (result[ARCHIVES_KEY] || []).filter((note) => !query || [note.title, note.url, note.content].join(' ').toLowerCase().includes(query));
  const list = $('archiveList');
  if (!archives.length) {
    list.innerHTML = '<div class="archive-empty">还没有归档笔记<br>关闭有内容的标签页后会自动保留在这里</div>';
    $('archiveSelectionCount').textContent = '未选择';
    $('exportSelectedArchives').disabled = true;
    $('selectAllArchives').checked = false;
    $('selectAllArchives').indeterminate = false;
    return;
  }
  list.innerHTML = archives.map((note) => `<div class="archive-card" data-id="${escapeHtml(note.id)}"><div class="archive-card-head"><label class="archive-select-wrap"><input type="checkbox" class="archive-select" aria-label="选择笔记"></label><h3>${escapeHtml(note.title || '未命名笔记')}</h3><div class="archive-card-actions"><button data-action="rename" title="重命名">✎</button><button data-action="delete" title="删除">×</button></div></div><p>${escapeHtml(note.content || '')}</p><time>${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(note.archivedAt || note.updatedAt))}</time></div>`).join('');
  list.querySelectorAll('.archive-select').forEach((input) => input.addEventListener('change', updateArchiveSelection));
  list.querySelectorAll('.archive-card').forEach((card) => {
    card.addEventListener('click', async (event) => {
      const action = event.target.closest('button')?.dataset.action;
      const id = card.dataset.id;
      if (action === 'rename') return renameArchive(id);
      if (action === 'delete') return deleteArchive(id);
      if (event.target.closest('input')) return;
      const note = archives.find((item) => item.id === id);
      if (!note) return;
      $('libraryPanel').classList.add('hidden');
      await loadArchiveNote(note.id);
    });
  });
  updateArchiveSelection();
}

async function takeScreenshot() {
  if (!activeTab?.windowId) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'capture-screenshot', tabId: activeTab.id });
    if (!response?.ok || !response.dataUrl) throw new Error(response?.error || 'capture failed');
    const alt = (activeTab.title || '网页截图').replace(/[\[\]]/g, '');
    await insertImageDataUrl(response.dataUrl, alt, '截图已插入笔记');
  } catch (error) {
    showToast(error.message || '截图失败，请确认当前页面可见');
  }
}

async function applyContextAction(pending) {
  if (!pending || String(activeTab?.id) !== String(pending.tabId)) return;
  if (pending.action === 'screenshot') {
    await takeScreenshot();
    return;
  }
  if (!pending.text?.trim()) {
    showToast('右键操作需要先选中文字');
    return;
  }
  if (pending.action === 'summary') {
    appendSummary(pending.text, pending.source);
    return;
  }
  appendCapture(pending.text, pending.source, pending.action);
}

async function consumePendingContextAction(tabId) {
  const result = await chrome.storage.local.get('pendingContextAction');
  const pending = result.pendingContextAction;
  if (!pending) return;
  if (Date.now() - pending.createdAt > 120000 || String(pending.tabId) !== String(tabId)) {
    if (Date.now() - pending.createdAt > 120000) await chrome.storage.local.remove('pendingContextAction');
    return;
  }
  await chrome.storage.local.remove('pendingContextAction');
  await applyContextAction(pending);
}

async function handleImagePaste(event) {
    const items = [...(event.clipboardData?.items || [])];
    const hasImageItem = items.some((item) => item.type.startsWith('image/'));
    const html = event.clipboardData?.getData('text/html') || '';
    const hasDataImage = /<img[^>]+src=["']data:image\//i.test(html);
    if (!hasImageItem && !hasDataImage) return;
    event.preventDefault();
    try {
      const image = await getClipboardImage(event);
      if (!image) return;
      await insertImageBlob(image, '粘贴图片');
    } catch (error) {
      showToast(error.message || '图片粘贴失败');
    }
}

function bindEvents() {
  editor.addEventListener('input', scheduleSave);
  editor.addEventListener('paste', handleImagePaste);
  visualEditor.addEventListener('input', () => {
    editor.value = htmlToMarkdown(visualEditor);
    updateView();
    scheduleSave();
  });
  visualEditor.addEventListener('paste', handleImagePaste);
  $('editModeButton').addEventListener('click', () => {
    $('editModeButton').classList.add('active');
    $('previewModeButton').classList.remove('active');
    editor.classList.add('hidden');
    visualEditor.classList.remove('hidden');
    $('preview').classList.add('hidden');
    void refreshVisualEditor();
    updateView();
  });
  $('previewModeButton').addEventListener('click', () => {
    $('previewModeButton').classList.add('active');
    $('editModeButton').classList.remove('active');
    editor.classList.add('hidden');
    visualEditor.classList.add('hidden');
    $('preview').classList.remove('hidden');
    updateView();
  });
  $('renameNoteButton').addEventListener('click', renameCurrentNote);
  $('noteSwitcher').addEventListener('change', async (event) => {
    const [type, id] = event.target.value.split(':');
    if (type === 'archive' && id) await loadArchiveNote(id);
    if (type === 'tab' && String(activeTab?.id) === id) await loadNote();
  });
  $('exportButton').addEventListener('click', () => {
    exportContext = { type: 'current' };
    $('exportModal').classList.remove('hidden');
  });
  $('closeExportButton').addEventListener('click', () => $('exportModal').classList.add('hidden'));
  $('exportModal').addEventListener('click', (event) => { if (event.target === $('exportModal')) $('exportModal').classList.add('hidden'); });
  document.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => {
    const format = button.dataset.export;
    if (exportContext.type === 'archives') {
      void exportSelectedArchives(format, exportContext.ids);
      return;
    }
    const title = safeFilename(activeNote?.title, 'tab-note');
    void exportNote(format, title);
  }));
  $('archiveButton').addEventListener('click', archiveCurrent);
  $('clearButton').addEventListener('click', clearCurrent);
  $('templateButton').addEventListener('click', editCaptureTemplate);
  $('libraryButton').addEventListener('click', () => { $('libraryPanel').classList.remove('hidden'); renderArchives(); });
  $('closeLibraryButton').addEventListener('click', () => $('libraryPanel').classList.add('hidden'));
  $('searchInput').addEventListener('input', renderArchives);
  $('deleteSelectedArchives').addEventListener('click', deleteSelectedArchives);
  $('selectAllArchives').addEventListener('change', (event) => {
    $('archiveList').querySelectorAll('.archive-select').forEach((input) => { input.checked = event.target.checked; });
    updateArchiveSelection();
  });
  $('exportSelectedArchives').addEventListener('click', () => {
    const ids = getSelectedArchiveIds();
    if (!ids.length) { showToast('请先选择归档笔记'); return; }
    exportContext = { type: 'archives', ids };
    $('exportModal').classList.remove('hidden');
  });
  $('themeButton').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('tab-md-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'selection-action') appendCapture(message.text, message.source, message.action === 'plain' ? 'plain' : message.action);
    if (message.type === 'context-action') {
      if (activeNoteType === 'tab' && String(activeTab?.id) === String(message.tabId)) void consumePendingContextAction(message.tabId);
      else void loadNote();
    }
  });
  chrome.tabs.onActivated?.addListener(loadNote);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ARCHIVES_KEY]) {
      renderArchives();
      void populateNoteSwitcher();
    }
  });
}

if (localStorage.getItem('tab-md-theme') === 'dark') document.body.classList.add('dark');
bindEvents();
loadNote();




