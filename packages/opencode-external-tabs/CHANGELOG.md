# opencode-external-tabs

## 0.3.0

### Minor Changes

- 5ff1735: Add OpenCode Desktop support: Desktop opens sessions created by other clients as background tabs, following `tab: false` and `tab: true` metadata. List the plugin in the global `opencode.json` to use it in both.

## 0.2.0

### Minor Changes

- 61e4ea1: Respect session metadata `tab`: sessions created with `tab: false` don't open, and setting `tab: true` later opens them.

## 0.1.1

### Patch Changes

- 443f6de: Publish from GitHub Actions with npm provenance.
