# Vertical Tabs

A Chrome extension that provides a vertical tab manager with group management in the side panel.

## Features

- **Vertical tab list** — View all open tabs in a sidebar, organized by group
- **Tab groups** — Create, rename, collapse/expand, and color-code tab groups
- **Primary groups** — Mark groups as "primary" to protect them from bulk-close actions
- **Close non-primary** — Quickly close all tabs that aren't in a primary group
- **Auto-group by domain** — Automatically group ungrouped tabs by their domain
- **Drag & drop** — Move tabs between groups or to the ungrouped section
- **Collapsible panel** — Toggle between full view and icon-only mode; state persists across sessions
- **Search** — Type-to-search filters tabs and groups in real time
- **Keyboard shortcut** — Open the side panel with a shortcut (customizable)
- **Dark theme** — Matches Chrome's dark UI

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select this project folder
5. Click the extension icon in the toolbar to open the side panel

## Usage

- **Click a tab** to switch to it
- **Click a group header** to collapse/expand the group
- **Long-press a group title** to rename it
- **Click the star** on a group header to toggle primary status
- **Drag a tab** onto a group header to move it into that group, or onto the ungrouped zone to remove it from its group
- **Click "+"** to create a new group from the active tab
- **Click "Auto"** to auto-group ungrouped tabs by domain
- **Click "Close Non-Primary"** to close all tabs outside of primary groups
- **Click «/»** in the header to toggle collapsed (icon-only) mode — hover favicons to see tab names
- **Start typing** to search/filter tabs

## Keyboard Shortcut

The extension comes with a suggested shortcut to toggle the side panel:

| Platform      | Default shortcut |
|---------------|-----------------|
| macOS         | `Ctrl+B`        |
| Windows/Linux | `Alt+B`         |

You can customize this (or set your own, e.g. `Cmd+B`) at **`chrome://extensions/shortcuts`**.

## Requirements

- Chrome 116 or later (Manifest V3 side panel API)

## Project Structure

```
├── manifest.json      # Extension manifest (Manifest V3)
├── background.js      # Service worker — state management & Chrome API calls
├── sidepanel.html     # Side panel UI
├── sidepanel.js       # Side panel logic — rendering, events, drag & drop
├── sidepanel.css      # Styles
└── icons/             # Extension icons (16, 32, 48, 128)
```

## License

This project is licensed under the [MIT License](LICENSE).
