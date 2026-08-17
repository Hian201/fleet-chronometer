# Fleet Chronometer

[繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

<p>
  <a href="https://chromewebstore.google.com/detail/fleet-chronometer-kancoll/akinifhdgdafifijckbbahfeoikkknip">
    <img src="https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png" alt="Available in the Chrome Web Store" width="206" height="58">
  </a>
</p>

A passive Common Operational Picture (COP) browser extension for **KanColle
(艦隊これくしょん -艦これ-)** — fleets, expeditions, docking, base air corps,
sortie progress, battle prediction, and fuel/ammo estimation, all in one
panel, backed by a local history you can search, chart, and back up.

This is a fan-made companion tool. It is not affiliated with, endorsed by,
or sponsored by DMM.com or Kadokawa Games. "KanColle" and all game assets
belong to their respective owners.

> **Public testing notice:** This project has only recently entered public
> testing. We recommend running it alongside another companion tool and
> cross-checking important information to avoid surprises caused by display
> or prediction errors.

## Why this exists

Chrome / Chromium is ending Manifest V2: from Chromium 150 onward, remaining
MV2 code paths and workarounds are being removed, and the Chrome Web Store is
scheduled to remove remaining MV2 extensions on **31 August 2026**. Tools that
still depend on MV2 (for example [KC3Kai](https://github.com/KC3Kai/KC3Kai))
can no longer be relied on in current Chrome. This project is an emergency
**Manifest V3** response — passive observation and local computation only. It
does not replace the game, and it does not claim feature or data parity with
existing tools. This is an independently developed personal project with no
affiliation, collaboration, or licensing relationship with [KC3Kai](https://github.com/KC3Kai/KC3Kai)
or its original authors. It is intended solely as a personal fallback.

**Do not treat this extension's displays or predictions as your only source of
truth.** Back up anything that matters (use the local backup feature, or
whatever else you already trust).

## What it does

- **Live panel** — fleet HP/fatigue/supply, expedition & docking countdowns
  (with notifications), base air corps, map gauge progress.
- **Battle prediction** — projected end-of-battle HP, rank, MVP, and
  citadel/heavy-damage warnings, computed from the same packets the game
  sends you.
- **Fuel/ammo estimation** — per-node consumption estimate mid-sortie,
  corrected against real numbers on return to port.
- **Sortie log** — one card per sortie: route, formation, per-node combat
  detail, support fleet / base air corps waves, exportable as a KC3Kai
  battleplayer replay.
- **Resource log** — a single multi-line chart across all eight materials,
  with per-event-stage consumption breakdown.
- **Event operations board** — tracks sally-tag assignment rules per stage
  so you don't accidentally lock a ship into the wrong route.
- **Fleet & equipment roster** — full filterable/sortable inventory views.
- **Local backups** — export/import to a folder you choose (e.g. a
  Google Drive Desktop sync folder), with an offline HTML viewer that needs
  no extension installed to read a replay back.
- **Fit to Window** — fit the game canvas into the browser window; resize the window to change size; mute audio.

## How it works

![The game talks to its servers exactly as it always has. Fleet Chronometer only
reads a read-only copy of responses the game has already received, deletes your
login token, files each record through a single entry point, keeps everything in
your browser's local database, and computes fleet state and battle predictions on
your own machine. It never sends, alters or resends game traffic, never automates
play, and never uploads anything.](docs/architecture-en.svg)

## Privacy & safety, by design

- **Passive capture only.** The extension observes traffic the game already
  sends; it never replays, modifies, or sends requests on your behalf.
- **No account credentials leave your browser.** `api_token` is stripped
  before anything is stored or broadcast internally, and is never persisted.
- **Nothing is uploaded anywhere.** All data lives in your browser's local
  IndexedDB. There is no backend server.
- **Minimal permissions**, requested only when a specific feature needs
  them (e.g. Fit to Window asks for access to the DMM game page only when
  you click the button for it — never on install).

See the project's internal documentation for the full design constraints
this extension is built to.

## Tech stack

[WXT](https://wxt.dev/) + TypeScript + [Dexie](https://dexie.org/) (IndexedDB).
Pure front-end, Manifest V3, no backend.

## Building from source

```bash
npm install
npm run build        # outputs .output/chrome-mv3 — load as an unpacked extension
npm run dev           # dev mode with auto-rebuild
npm test              # vitest suite
```

Load `.output/chrome-mv3` via `chrome://extensions` → "Load unpacked".
After editing source, rebuild and click the extension's reload button; any
already-open game tab needs a manual refresh too (an MV3 content-script
limitation).

## Contributing

This is primarily a personal project maintained by one person. Bug reports
and suggestions via Issues are welcome. I may not have the bandwidth to
review or merge external pull requests — feel free to fork if you want to
run your own changes.

## License

- Source code: [MIT](LICENSE).
- Original icon/app-icon assets (`public/icons/`, `public/icon/`,
  `tools/app-icon/`): **not** covered by the MIT grant — see
  [ASSETS-LICENSE](ASSETS-LICENSE).
- Third-party data and algorithms referenced from other open-source
  projects retain their original licenses — see
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
