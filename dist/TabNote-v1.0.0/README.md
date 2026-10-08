# TabNote

A Chrome Manifest V3 side-panel Markdown clipping tool organized by browser tab.

## Run locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked and select this folder.
4. Open any page and click the extension icon to open the side panel.

## MVP features

- One browser tab maps to one independent note; refreshes and in-site navigation do not reset it.
- Side-panel Markdown editor and preview mode.
- Select text on a page and use the browser context menu under `TabNote` for `摘录`, `引用`, `标记`, or `摘要`; the same menu can capture the current page.
- Pasted images and screenshots are converted to `data:image/...;base64,...` Markdown once and rendered directly in the note.
- Local persistence through `chrome.storage.local`.
- Export as plain Markdown, embedded-image Markdown, Word-compatible `.doc`, browser print-to-PDF, or ZIP package; manual archive, archive search, bulk management, custom clip template, and dark mode.
- Notes with content are automatically preserved in the archive when their tab closes.

## Export note

- Word export is a local HTML document saved with a `.doc` extension so Microsoft Word and compatible editors can open and edit it.
- PDF export opens the browser's native print dialog. Choose `Save as PDF` in that dialog; no server or external library is used.

## Screenshot and selection note

- Screenshot capture is requested from the browser context menu and executed by the background service worker.
- Selecting text alone never saves anything; use `TabNote` in the browser context menu to choose the exact operation.

## Note switching and naming

- Use the note selector at the top of the side panel to switch between the current tab note and notes in the global library.
- Click the pencil button beside the selector to rename the current note. A custom name is kept when the page title changes.
- Opening an archived note from the selector loads it into the editor without overwriting the current tab note.

## Summary, templates, and pasted images

- Select text on a page, right-click, and choose `TabNote > 摘要选中文字`. The summary is generated locally and is not uploaded.
- The `模板` button controls the format used by plain-text clipping. It supports `{{text}}`, `{{title}}`, and `{{url}}`; the template does not change quote or highlight modes.
- Focus the editor and press `Ctrl+V` to paste an image copied from another app. TabNote supports standard image clipboard data and common HTML/Data URL image clips, then writes the image as an inline Base64 Markdown image.
- Use `TabNote > 截图当前页面` in the browser context menu to capture the current tab's visible area. If Chrome blocks the page, the side panel shows the specific reason instead of silently failing.

## Bulk export

- Open `笔记库`, select multiple notes or use `全选`, then click `导出所选`.
- The selected notes can be exported as Markdown, Word-compatible `.doc`, browser print-to-PDF, or a ZIP package with separate image files.

## Product behavior note

Chrome's `tabs.onRemoved` event fires after the tab is gone, so an extension cannot reliably show a blocking confirmation dialog after the close action. This MVP uses automatic local archiving for non-empty notes to prevent silent data loss.

