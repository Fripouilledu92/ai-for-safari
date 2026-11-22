# Privacy policy — AI for Safari

Last updated: November 22, 2026.

AI for Safari (the Safari extension, the panel app, the local programs and the Claude Code plugin) is an independent
open-source project. It has no server, no account and no analytics. The developer receives no data from you.

## What is collected

Nothing is collected by the developer. Everything below stays on your Mac or goes to Anthropic through Claude.

## What is processed on your Mac

- **Web pages**: when Claude calls a tool, the program reads the page (text, structure, screenshots, console and
  network logs, sound) of the Safari tab Claude works in: its own window, or the tab you handed to it from the panel.
  It never reads your other tabs.
- **Your voice**: when you dictate in the panel, the microphone is used only while dictation is on, and the sound is
  turned into text by Apple's speech recognition on macOS.
- **Settings and history**: the sites you allowed and your panel conversations are stored in `~/.claude-safari`,
  readable by your macOS account only. You can delete that folder at any time.
- **Screenshots and recordings**: screenshots are kept in memory (the last 8) and written to disk only when Claude is
  asked to save one (`~/.claude-safari/captures`). GIF recordings are saved to your Downloads folder.

## What is sent, and to whom

- **To Anthropic, through Claude**: what you write in the panel or in Claude Code, and the page content Claude reads
  with a tool to answer you. This goes through the official `claude` command or Claude app, under your own Claude
  account and Anthropic's privacy policy (https://www.anthropic.com/legal/privacy). AI for Safari adds no other
  destination.
- **To no one else**: the programs make no other network request. The local panel program listens only on
  `127.0.0.1` (your Mac) and answers only the Safari extension you paired.

## Retention

Data stored on your Mac stays until you delete it (`~/.claude-safari`, your Downloads folder, or the uninstall steps in
the README). Screenshots kept in memory are limited to the last 8 and disappear when the program stops.

## Children

AI for Safari is not intended for people under 18.

## Contact

Open an issue at https://github.com/Fripouilledu92/ai-for-safari/issues. For a security problem, say so in the title
and do not include private data.
