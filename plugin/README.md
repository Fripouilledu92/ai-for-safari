# AI for Safari (plugin)

Lets Claude work in Safari on your Mac: open its own window and tabs, read pages, click, type, fill forms, take
screenshots, read console and network logs, and listen to the sound a page plays. These are the same tools as
Claude in Chrome, for Safari. Independent project, not made or endorsed by Anthropic or Apple.

macOS only. It runs in Claude Code and in Cowork sessions on your computer (local MCP server).

## Before you install the plugin

The plugin needs the AI for Safari app and Safari extension on the same Mac. They carry the small program that talks
to Safari. Install them by hand first, following the main [README](../README.md) ("Installer à la main"): download, check
the fingerprint, read `installer.sh`, run it. Without them, every tool answers with a clear "not installed" message
and does nothing.

## Install the plugin

After the app and extension are installed, in Claude Code:

```
/plugin install ai-for-safari --marketplace Fripouilledu92/ai-for-safari
```

If you used the AI for Safari installer, it also added the same tools as a connector named `ai-for-safari`. Keep one of
the two: `claude mcp remove --scope user ai-for-safari` removes the connector.

## Example requests

1. "Open the Wikipedia page about Lyon in Safari and summarize the history section."
2. "In my Safari tab, fill in the contact form with my name and the message I wrote above, but don't send it."
3. "Play the video on this page for 20 seconds and tell me what is said."
4. "On the page I have open in Safari, fill in the form for me." (Claude asks to take over that tab; you allow it in
   a macOS dialog and watch it work.)

## What it runs, reads and sends

- **Runs**: `/usr/bin/python3 serveur/serveur.py` (this folder), a local MCP server with 19 tools. It starts the
  Safari bridge already compiled on your Mac by the AI for Safari installer
  (`~/Library/Application Support/AI for Safari/pont/bin/pont-safari`). It downloads nothing and installs nothing.
- **Reads**: only the Safari tabs Claude opened in its own window, or a tab you handed to it (from the AI for Safari
  panel, or by allowing its request in a macOS dialog). Page text, structure, screenshots and sound are read only when Claude calls a tool.
- **Sends**: tool results go back to Claude, in your conversation, like any tool. The server makes no network
  request of its own and listens on no port.
- **Stores**: your site choices in `~/.claude-safari`, readable by your account only. Screenshots stay in memory (the
  last 8) unless Claude is asked to save one (`~/.claude-safari/captures`); GIF recordings go to Downloads.

## Permissions it relies on

To act in pages, macOS asks whether the app may "control Safari", and Safari needs "Allow JavaScript from Apple
Events" (Safari > Settings > Advanced > "Show features for web developers", then Developer). That Safari setting
lets any app you allowed to control Safari run JavaScript in your pages, so only allow apps you know, and turn it
off when you don't use Claude in Safari. Details: main [README](../README.md).

## Safety rules built in

- Claude acts only on sites you allow (asked site by site, or all sites if you chose so), and some sites are always
  refused.
- It never types passwords, verification codes, card or bank numbers, and never solves captchas.
- It asks you before sending, posting, buying, deleting or creating an account.
- File uploads outside Downloads, Desktop and screenshots need your confirmation in a macOS dialog; sensitive files
  (SSH keys, keychains, `.env`) are always refused.

## Privacy and support

- Privacy policy: [PRIVACY.md](../PRIVACY.md).
- Questions or security issues: open an issue at https://github.com/Fripouilledu92/ai-for-safari/issues.

## License

MIT, see [LICENSE](LICENSE).
