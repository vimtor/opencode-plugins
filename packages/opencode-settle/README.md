# opencode-settle

OpenCode plugin that lets an agent hand you its open decisions as a deck, which you settle two options at a time in a panel beside the session.

Each decision is a question with two or more options. An option can show text, code, an image or an HTML mockup. You see two options at a time and keep one until one is left. Your answers are attached to your next message, so you can add a line of your own before you send them.

Requires OpenCode Desktop 2.3.0 or later. The panel uses OpenCode's experimental desktop plugin API, and there's no terminal version yet.

## Install

Add the package to your global `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-settle"]
}
```

OpenCode Desktop only loads plugins from the global `opencode.json`. OpenCode installs npm plugins automatically at startup.

## Use

Ask the agent to settle something, for example “let's settle how the settings page should look”. It calls the `settle` tool with a deck, the deck opens in a side panel, and the agent carries on without waiting.

In the panel:

| Key | Action |
| --- | --- |
| K | Keep the top option |
| J | Keep the bottom option |
| S | Snooze the decision until the end |
| D | Discard the decision without answering it |
| U | Undo the last pick |
| C | Copy the decision as Markdown |

K and J act on release, like a click. Clicking a card keeps it too.

When the last decision is settled, your answers are attached to the composer and the panel closes. `/settle` reopens the decks in this session that are still waiting.

## Decks

The agent writes a deck as the tool's input:

```json
{
  "title": "Settings page",
  "axes": [{ "id": "look", "title": "How it looks" }],
  "decisions": [
    {
      "id": "layout",
      "axis": "look",
      "question": "How is the Settings page laid out?",
      "options": [
        { "id": "sidebar", "title": "Sections in a sidebar", "blocks": [{ "type": "text", "text": "Like System Settings." }] },
        { "id": "single", "title": "One long page", "blocks": [{ "type": "html", "html": "<div>…</div>" }] }
      ]
    }
  ]
}
```

An option can carry a one-word `tag`, such as `Recommended` or `Current`, shown next to its title. Use it rarely.

Blocks are `text` (Markdown), `code` (with a `language`), `image` (an https or data: URL with `alt`) and `html`. HTML mockups run in a sandboxed frame with no scripts, on the app's page colour, and grow to fit their content.
