# LibreWolf Workspaces

A personal LibreWolf 158.0 workspace overlay: named workspaces, workspace-specific tab colors, collapsible workspace tab sets, a workspace panel, a tab context-menu mover, and a lightweight RAM limiter.

## What is included

- The exact browser-source overlay used by this build, under `overlay/`.
- `scripts/apply-overlay.sh` to copy the overlay into a LibreWolf 158.0 source checkout.
- `userChrome.example.css`, the optional square-corner Noctalia UI theme used alongside it.

Workspace tabs are kept at the left edge of the tab strip; ordinary Default-workspace tabs follow them. Only named-workspace tabs receive a thin workspace-color outline.

## Apply to a LibreWolf 158.0 source tree

```bash
./scripts/apply-overlay.sh /path/to/librewolf-158.0-1
cd /path/to/librewolf-158.0-1
./mach build
```

Then package or install using the normal LibreWolf build flow.

## Optional profile styling

Copy `userChrome.example.css` to:

```text
<profile>/chrome/userChrome.css
```

and set `toolkit.legacyUserProfileCustomizations.stylesheets` to `true` in `about:config`.

## License and attribution

The overlay files retain the Mozilla Public License 2.0 headers and are distributed under MPL-2.0. LibreWolf is maintained by the LibreWolf project; this repository is an independent personal customization overlay, not an official LibreWolf release.

## Prebuilt Linux package

The [latest release](https://github.com/AriCuteGirl/librewolf-workspaces/releases/latest) includes a Linux x86_64 portable archive. Extract it and run `./install.sh`; it creates a `librewolf-workspaces` launcher and application-menu entry without touching an existing system LibreWolf/Firefox installation.
