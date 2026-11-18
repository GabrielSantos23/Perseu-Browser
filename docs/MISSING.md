# Perseu Browser — Comprehensive Gap Analysis & Missing Pieces

> **Scope of this analysis:** Full audit of `Perseu-Browser` across its Chromium 157 patch layer (`patches/`, `flecha/flecha-chromium-157.patch`), build & packaging scripts (`build.py`, `package.py`, `flecha/ci/stage_shell.py`), GitHub Actions CI/CD (`.github/`), Manifest V3 shell extension (`flecha/chromium/shell/`), native messaging host (`flecha/chromium/native-host/`), security/privacy posture, and legal/distribution readiness.

---

## 1. Executive Summary

Perseu Browser is an Arc/Zen-inspired vertical-sidebar browser for Windows built by combining:
1. **`ungoogled-chromium-windows`** (Chromium `157.0.8103.x` with PGO and proprietary codecs),
2. **Flecha's C++ Chromium patches** (`FlechaFrameView`, `chrome.flechaPrivate`, per-Space `StoragePartition`s, Peek, Mini Windows / Flechinha, plus custom Windows additions for browser import, onboarding window sizing, top bar, Zen grain textures, and Ed25519 auto-updates),
3. **A Manifest V3 component-extension shell** (`flecha/chromium/shell`, TypeScript + esbuild) that renders the sidebar, top bar, command palette, settings, media player, and onboarding, and
4. **Bundled uBlock Origin** staged as a component extension (`flecha/chromium/extensions/fetch.mjs`).

While local builds compiled from the author's hand-maintained `C:\uc\build\src` tree work well as a single-window daily driver, **the repository is currently missing critical pieces required for reproducible builds, functional parity on Windows, multi-window usage, privacy consistency, and safe public distribution.**

| Severity | Area | Summary of Key Gaps |
| :--- | :--- | :--- |
| **P0 — Critical** | Build, Patching & CI/CD | Active patch in `patches/series` is ~135 KB stale; post-substitution hunk in `extension_urls.cc` fails/reverts in `build.py`; Perseu icons aren't copied in builds; portable `.zip` omits the shell entirely. |
| **P1 — High** | Broken Windows Features | Native messaging host missing on Windows (breaks HTML bookmark import & Coding Agents); external links don't open in Mini Windows on Windows; "Open in Mini Window" opens Peek; multi-window (`Ctrl+N`) breaks state sync. |
| **P2 — Medium** | Incomplete UI & Browser Features | Now Playing seek bar is dead code; Site Controls panel omits site permissions; Settings missing Default Browser & Downloads folder; no Backup Export; Bookmarks/Passwords/Profiles disconnected; no Widevine DRM. |
| **P2 — Medium** | Security, Privacy & Signing | Unsigned binaries trigger SmartScreen; search suggestions leak keystrokes to Google regardless of chosen engine; `MAIN`-world script injected into all sites; 45-port localhost scanner runs every 30s. |
| **P3 — Polish** | i18n, Branding, Tests & Legal | Hardcoded macOS copy/glyphs (`"on this Mac"`, `⌘`); English/Portuguese mix with no i18n; Phase 5 dev leftovers unremoved; almost zero automated tests; unverified artwork licenses & missing GPL/MPL notices. |

---

## 2. P0 — Build, Patching & CI/CD Blockers (Clean Builds Broken)

Right now, cloning `Perseu-Browser` and running `python build.py` (or running GitHub Actions CI) **will not produce the current Perseu Browser**.

### 2.1 Three Diverging Copies of `flecha-chromium-157.patch` (Active Patch Is Stale)
There are three tracked copies of the Chromium 157 patch in the repository, all with different sizes and hashes:
- `patches/flecha/flecha-chromium-157.patch` — **216 KB (68 files)** — **This is the file referenced by `patches/series` (line 27) and actually applied by `build.py` (line 234).** It has never been updated since the very first Flecha commit (`feb2f26`).
- `flecha/chromium/patches-windows/flecha-chromium-157.patch` — **347 KB** — Missing recent commits such as Zen theme textures (`05e1309`).
- `flecha/flecha-chromium-157.patch` — **351 KB (108 files)** — Contains all recent C++ work, **but nothing in `build.py` applies it.**

**Impact:** Any clean or CI build misses ~40 files of C++ changes, including the `Perseu` product rename (`BRANDING`, `chromium_strings.grd`, `chromium_install_modes.h`, `grit`), the Windows updater (`prepareUpdate`/`installUpdate`), Windows browser import (`flecha_browser_import.cc`), onboarding window sizing (`SetWelcome`), `chrome://settings/perseu/*` embedding, bundled extensions (`--flecha-extensions-dir`, `chrome.release`), Windows top bar & caption button layout, media session controls, and Zen Space textures.

### 2.2 Patch vs. Domain-Substitution Ordering Bug in `build.py`
In `flecha/flecha-chromium-157.patch` (lines 8036–8045), `extensions/common/extension_urls.cc` is diffed against an already domain-substituted file:
```diff
 const char kChromeWebstoreUpdateURL[] =
-    "https://clients2.9oo91e.qjz9zk/service/update2/crx";
+    "https://clients2.google.com/service/update2/crx";
```
However, in `build.py` (lines 233–246), **`patches.apply_patches(...)` runs *before* `domain_substitution.apply_substitution(...)`**:
1. On a clean Chromium source tree, `extension_urls.cc` still has `clients2.google.com`, so `patch.exe` will **reject** the hunk.
2. Even if applied, `domain_substitution.apply_substitution()` runs immediately afterward and rewrites `clients2.google.com` back into `clients2.9oo91e.qjz9zk`, silently breaking Chrome Web Store extension updates.

### 2.3 Perseu Icons & Visual Branding Assets Are Never Copied in `build.py`
On macOS, `flecha/chromium/scripts/apply.sh` (lines 18–22) copies icons into `chrome/app/theme/chromium/`. On Windows, **`build.py` and `flecha/ci/stage_shell.py` never copy**:
- `flecha/chromium/branding/win/chromium.ico` → `chrome/app/theme/chromium/win/chromium.ico`
- `flecha/chromium/branding/logo/*.png` → `chrome/app/theme/chromium/`
- `flecha/chromium/branding/logo-scaled/{100,200}/*.png` → `chrome/app/theme/default_{100,200}_percent/chromium/`
- Start Menu tile icons (`Logo.png`, `SmallLogo.png` for `VisualElementsManifest.xml`)

Because `export_patch.sh` only diffs files listed in `C:\uc\flecha-touched.txt` and GNU `patch.exe` cannot apply Git binary diffs, clean/CI builds compile with stock blue Chromium icons.

### 2.4 Portable `.zip` Archive Missing Shell & Bundled Extensions
- `flecha/flecha-chromium-157.patch` adds `resources\flecha-shell` and `resources\flecha-extensions` to `chrome/installer/mini_installer/chrome.release` (for `mini_installer.exe`), **but never adds them to `chrome/tools/build/win/FILES.cfg`**.
- `package.py` (lines 86–90) builds the `.zip` distribution exclusively from `FILES.cfg`. Anyone extracting the `.zip` gets a browser whose tab strip and toolbar are hidden (`FlechaHidesTopChrome`) with no `flecha-shell` extension loaded — leaving a blank, unusable window.

### 2.5 `manifest.json` `minimum_chrome_version` Mismatch
- `flecha/chromium/shell/manifest.json` (line 7) sets `"minimum_chrome_version": "158"`, while Perseu targets Chromium **157**.
- `flecha/ci/stage_shell.py` overrides this via `FLECHA_MIN_CHROME`, but running `npm run shell:build` directly (as instructed in root `README.md` line 4) leaves `"158"` in `dist/manifest.json`.

### 2.6 Non-Reproducible Local Scripts & Uninitialized Submodule
- `docs/scripts/export_patch.sh` and `docs/scripts/run-build.ps1` depend on hardcoded machine-local paths (`C:\uc\build\src`, `C:\uc\pre-flecha-backup.tar`, `C:\uc\pre-flecha-backup2.tar`, `C:\uc\flecha-touched.txt`, and a temporary folder `/c/Users/gabs/AppData/Local/Temp/claude/...`). There is no self-contained patch series or scripted patch-refresh workflow inside the repository.
- `.git/info/exclude` hides `/docs/` from Git, so build/release documentation and helper scripts are untracked.
- The `ungoogled-chromium` submodule directory is currently empty/uninitialized in the local checkout (`git submodule update --init` required).

### 2.7 CI/CD Pipeline Gaps & Leftover Upstream Workflows
- **Untested auto-release pipeline:** `.github/workflows/perseu-auto.yml` has never been executed end-to-end on GitHub Actions (`docs/README.md` line 120).
- **Dangerous upstream release workflow still present:** `.github/workflows/publish-release.yml` still contains `ungoogled-chromium-windows` logic targeting `Nifury/ungoogled-chromium-binaries` and `komac update eloston.ungoogled-chromium` for WinGet.
- **Artifact naming:** `package.py` (lines 64–78) still names outputs `ungoogled-chromium_<version>_installer_<arch>.exe` and `ungoogled-chromium_<version>_windows_<arch>.zip`.
- **No fast CI check on PRs/pushes:** `flecha/.github/workflows/ci.yml` sits inside the `flecha/` subdirectory where GitHub Actions ignores it. There is no root workflow running `npm run typecheck`, `npm run shell:build`, `update-feed.test.mjs`, or `shazamSignature.test.mjs`.
- **Dependabot:** `.github/dependabot.yml` monitors `/.github/actions/stage` and `/` Actions, but omits `/flecha` (`package.json`).

---

## 3. P1 — Broken or Non-Functional Features on Windows

Several user-visible features were designed for Flecha's macOS build and are broken or unwired on Windows:

### 3.1 Missing Native Messaging Host on Windows
On macOS, Flecha bundles Node.js + `flecha/chromium/native-host` inside the `.app` and registers `dev.oprimo.flecha.host.json` on startup (`app_controller_mac.mm` lines 449–498). On Windows, **`stage_shell.py` never builds `native-host`, no Node runtime or host executable is shipped in `mini_installer`, and no Windows Registry key (`HKCU\Software\Perseu\NativeMessagingHosts\dev.oprimo.flecha.host`) is written.** This breaks two features in Settings:
1. **HTML Bookmarks File Import (`Settings → Import → Bookmarks File`):** While browser auto-detection uses C++ (`flecha_browser_import.cc`), `nativeHost.ts` (`importBookmarksFile`, lines 247–254) still sends the already-loaded HTML string over native messaging (`call('readBookmarksHtml', ...)`). Selecting a `.html` file fails with: *"Perseu's helper isn't registered… Run chromium/scripts/install-native-host.sh."* (`bookmarksHtml.ts` is pure TypeScript and can run directly in the extension without a native host.)
2. **Coding Agents / MCP Server (`Settings → Developer → Coding Agents`):** Enabling the toggle attempts `chrome.runtime.connectNative('dev.oprimo.flecha.host')`, fails immediately, retries in a loop, and displays the macOS shell-script error in Settings.

### 3.2 "Open Links from Other Apps in a Mini Window" Is a No-Op on Windows
- `Settings → Tabs` has **"Open links from other apps in a Mini Window"** enabled by default (`openLinksInFlechinha`).
- In C++, `extensions::MaybeOpenLinkInFlechinha()` (`flecha_private_api.cc` line 1784) is **only called from `chrome/browser/app_controller_mac.mm` (line 523)**.
- There is no hook in Windows external-link handling (`StartupBrowserCreatorImpl::Launch` / `ProcessSingleton`), so links clicked in Slack, Discord, email clients, or terminals on Windows always open as normal tabs instead of Mini Windows.

### 3.3 Tab Context Menu "Open in Mini Window" Opens Peek Instead
- In `flecha/chromium/shell/background.ts` (lines 692–693):
  ```ts
  // A Flechinha window of its own; the window code lives in another shell module.
  { label: 'Open in Mini Window', run: does('openPeek', tab.url) },
  ```
- Clicking **Open in Mini Window** opens a Peek overlay of `tab.url` rather than moving the tab into an actual Mini Window (`openFlechinha(undefined, tabId)`).

### 3.4 `Ctrl+O` Shortcut Inside Mini Window Checks `metaKey` Instead of `ctrlKey`
- `flecha/chromium/shell/ui/flechinha.html` (line 44) tells the user: `<kbd>Ctrl+O</kbd> keeps it in Perseu`.
- `flecha/chromium/shell/ui/flechinha.ts` (line 134) checks `if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o')`, which requires the Windows/Command key (`metaKey`) instead of `Ctrl` (`ctrlKey`) when focus is inside the Mini Window toolbar.

### 3.5 Multi-Window Support (`Ctrl+N` / New Window) Is Architecturally Broken
- The browser menu (`background.ts` line 791) exposes **`New Window (Ctrl+N)`**, which creates a second normal `FlechaFrameView` window.
- However, `Store` (`flecha/chromium/shared/store.ts`) and `background.ts` have **no per-window state**:
  - `state.activeSpaceId` is global across the whole browser.
  - `space.activeTabId` is a single tab ID per Space.
  - `placeholder` (`background.ts` line 48) is a single tab ID, not per-window.
  - `mainWindow()` (`background.ts` line 280) routes tab creation/syncing only to `getLastFocused()`, while `broadcast('state', uiState())` pushes identical sidebar state to every window.
- Opening two windows causes both sidebars to mirror each other and fight over tab activation, splits, and placeholder tabs.

---

## 4. P2 — Missing Browser Features, UI Stubs & Half-Wired Functionality

### 4.1 Now Playing Media Card Is Missing Its Progress / Seek Bar
- `flecha_private_api.cc` implements `FlechaPrivateSeekMediaFunction` and returns playback `position` and `duration` in `getMedia`.
- `nowPlaying.ts` computes `progress: { current, duration }` and handles `seekMedia`.
- `ui/app.ts` (lines 2221–2242) still runs a `1000ms` `setInterval` querying `.np-slider` and `.np-progress .np-time` based on `npProgress`.
- **Missing piece:** When the player card was redesigned (`266dbb4`), `.np-slider` and `.np-progress` were omitted from `np`'s DOM (`ui/app.ts` lines 2288–2305) and `npProgress` is never assigned in `renderNowPlaying()`. Users cannot see track progress or seek, and dead timer code remains.

### 4.2 Site Controls Popover (`#site-panel`) Omits Site Permissions
- `flecha/chromium/shell/siteControls.ts` implements `setSitePermission` for `geolocation`, `media` (camera + microphone), `notifications`, and `clipboard-read`, plus `clearSiteData`, and `Store` persists `sitePermissions`.
- **Missing piece:** `#site-panel` (`ui/index.html` lines 80–102, `renderSitePanel()` in `ui/app.ts` lines 754–775) never renders permission toggles — it only shows Share URL, Extensions, Auto-PiP, Zoom, and a `More` menu that punts to `chrome://settings/content/siteDetails`.

### 4.3 Missing & Stubbed Settings (`NotYet` Placeholders)
- **Default Browser control missing from `Settings → General`:** `isDefaultBrowser` and `makeDefaultBrowser` are implemented in C++ and `settingsHandlers.ts`, and used in Onboarding (`onboarding.ts` line 672), **but `settings.html` (`data-pane="general"`) has no Default Browser row**, leaving users no way in Perseu's General settings to check or set Perseu as default browser later.
- **Downloads folder & "Ask where to save each file":** Stubbed in `settingsHandlers.ts` (lines 79, 104: `notYet('Choosing the downloads folder')`) and noted in `downloads.ts` (line 11). Neither `chrome.flechaPrivate` nor `settings.html` exposes `download.default_directory` or `download.prompt_for_download`.
- **Perseu State Backup Export:** Command bar offers **`Import a Perseu Backup`** (`importFlechaState` in `background.ts` line 1055), **but there is no `Export Perseu Backup` action or button** anywhere in Settings or the Command Bar to export Spaces, folders, and pinned tabs to JSON.
- **Native Emoji Picker stub:** `settingsHandlers.ts` (line 119) stubs `settings:emoji-panel` with `"The emoji picker button (press ⌃⌘Space) isn't in the Chromium build yet"` (Windows uses `Win+.`).

### 4.4 Disconnected Chromium Native Surfaces (Bookmarks, Passwords, History, Profiles)
- **`Menu → Bookmarks` opens an empty manager:** Perseu stores Favorites, Pinned tabs, and Folders in `chrome.storage.local` (`Store`), **not** in `chrome.bookmarks`. Yet `appMenu()` (`background.ts` line 795) exposes `Bookmarks` → `IDC_SHOW_BOOKMARK_MANAGER` (`chrome://bookmarks`), which is completely empty and out of sync with the sidebar (even imported bookmarks go into `Store` Spaces, not `chrome.bookmarks`).
- **Passwords, Payment Methods, Addresses & Profiles hidden:** `page_visibility.ts` (line 3990) sets `people: false` in `chrome://settings`, hiding the People/Autofill entry points, and `appMenu()` has no `Passwords` (`chrome://password-manager`) or `Profiles` menu item.
- **Full History page missing from menu/shortcuts:** Neither `appMenu()` nor `SHORTCUTS` (`lib/shortcuts.ts`) includes `History` (`Ctrl+H` → `chrome://history`), and command-bar history search is capped at 50 items.
- **Browser Import limitations on Windows:** `flecha_browser_import.cc` only imports Bookmarks (capped at `MAX_BOOKMARKS`) and History (capped at 5,000 rows). **Cookies, saved passwords, and Arc/Zen sidebar workspaces are not imported on Windows**, even though `settings.html` (line 66) tells the user *"Bring bookmarks, history and cookies over… so you stay signed in to your sites."*

### 4.5 Home / New Tab Page Incomplete Features
- **Dead mock features:** Onboarding's mock preview (`ui/onboarding.ts` line 269) renders `+ Add tabs or files`, and `docs/README.md` (line 157) notes both **"Add tabs or files"** and **voice/microphone search** on Home remain unimplemented.
- **Unused `topSites` pipeline:** `background.ts` (line 1049) and `flechaApi.ts` (line 216) implement `topSites()`, **but `ui/app.ts` never calls it** on the Home screen or empty command bar.

### 4.6 Split View Constraints
- **2-pane limit:** Only two tabs can be split at once (3–4 pane splits are unimplemented).
- **Pinned/Favorite split rendering quirk:** `todayRows()` (`ui/app.ts` line 484) only groups a split pair into a `.split-row` when *both* tabs belong to `space.today`. Splitting a Favorite or Pinned tab with a Today tab leaves them visually separated in the sidebar.

### 4.7 Missing Widevine CDM / DRM Streaming Support
- Because Perseu inherits `ungoogled-chromium`, **Widevine CDM (`widevinecdm.dll` + `.sig`) is not bundled or auto-downloaded**.
- Protected media on **Spotify Web, Netflix, Prime Video, Disney+, Apple Music, Tidal, and Deezer** (several of which are explicitly hardcoded in `nowPlaying.ts` line 28!) will fail to play unless a Widevine provisioning flow or component installer is added.

---

## 5. P2 — Branding, macOS Leftovers & Developer-Feature Bloat

### 5.1 Hardcoded macOS Copy & Symbols in a Windows Browser
| File | Lines | macOS-Specific Text / Behavior |
| :--- | :--- | :--- |
| `flecha/chromium/shell/settings.html` | 66 | *"Bring bookmarks, history and cookies over from another browser **on this Mac**, so you stay signed in..."* |
| `flecha/chromium/shell/settings.html` | 127 | *"Links from Slack, **Mail** or the terminal..."* |
| `flecha/chromium/shell/settings.html` | 163–164 | Hardcoded `<kbd>⌘</kbd>-click`, `<kbd>⇧</kbd>-click`, `<kbd>↩</kbd>`, `<kbd>⌫</kbd>` |
| `flecha/chromium/shell/settings.html` | 186, 209 | Hardcoded `<kbd>⌥⌘E</kbd>` and `<kbd>⌥⌘B</kbd>` |
| `flecha/chromium/shell/settings.html` | 221 | *"Only programs **on this Mac** that have the token can connect."* |
| `flecha/chromium/shell/ui/settings.ts` | 241 | *"No other browsers with bookmarks or history were found **on this Mac**."* |
| `flecha/chromium/shell/ui/flechinha.html` | 15–30 | `<div class="traffic-lights">` and hardcoded tooltips `⌘[`, `⌘]`, `⌘R`, `⌘L`, `⇧⌘C` |
| `flecha/chromium/shell/features.ts` | 115 | Toast: `"Press ⌥⌘I for the console"` |
| `flecha/chromium/shell/ui/index.html` | 19 | Unused `<div class="traffic-lights"></div>` in sidebar toolbar |

### 5.2 Incomplete Rebranding (`Perseu` vs. `Flecha` vs. `Chromium` vs. `ungoogled-chromium`)
- **Windows Registry & Binary Collisions (`chromium_install_modes.h` lines 7590–7598):**
  - Executable is still `chrome.exe` (`chrome.release`).
  - `direct_launch_url_scheme` is still `"chromium"` instead of `"perseu"`.
  - `active_setup_guid` (`{7D2B3E1D-D096-4594-9D8F-A6667F12E0AC}`) is identical to stock Chromium / `ungoogled-chromium`, risking registry collisions when both are installed.
- **Flecha naming throughout codebase & CLI flags:** `--flecha-shell-dir`, `--flecha-extensions-dir`, `--flecha-show-top-chrome`, `chrome.flechaPrivate`, `Storage/ext/flecha-space`, `flecha/package.json` (`"name": "flecha"`, `"productName": "Flecha"`), and `ui/settings.ts` (`claude mcp add ... flecha`).
- **Root `README.md`:** Still almost entirely `ungoogled-chromium-windows` documentation (telling users to run `winget install --id=eloston.ungoogled-chromium` and clone `ungoogled-chromium-windows`).
- **Dead macOS files in repo:** `flecha/chromium/branding/dmg/*`, `branding/mac/*`, `scripts/{dmg-layout.py,fetch-sparkle.sh,make-appcast.sh,package-release.sh}`, and macOS `.mm` hunks inside `flecha-chromium-157.patch`.

### 5.3 Unremoved "Phase 5" Developer-Only Features
`FLECHA-PORT-NOTES.md` (line 25) explicitly planned:
> *"Developer-only shell features (gh/npm/mdn shortcuts, JWT, MCP) live in the TS shell; remove in phase 5."*

None of Phase 5 has been carried out yet:
- **Background port scanner (`features/localServers.ts`):** Sends HTTP `HEAD` + `GET` probes to **45 localhost ports every 30 seconds** while focused (and every 2 minutes in background) to populate `#local-servers` in the sidebar. On Windows, probing 45 closed TCP ports every 30s wastes sockets/CPU (each refused TCP SYN waits ~1–2s on Windows loopback or triggers local firewall/EDR logs).
- **Universal `MAIN`-world console hook (`features/consoleHook.ts` + `consoleBridge.ts`):** Injected into **every `http://*/*` and `https://*/*` page at `document_start`** (`manifest.json` lines 17–18) just to count console errors on `localhost`. Running a `MAIN`-world script on every website adds overhead on every navigation and is detectable by anti-bot/anti-cheat scripts.
- **Developer UI panes & commands:** `Settings → Environments`, `Settings → Boosts` (TypeScript/CSS user-script compiler bundling Sucrase), `Settings → Coding Agents`, Responsive mobile-mirror debugger (`Ctrl+Alt+M`), and command-bar `gh`/`npm`/`mdn`/`caniuse`/`so`/JWT/Unix-timestamp decoders (`ui/devCommands.ts`) remain always-on rather than removed or gated behind a "Developer Mode" toggle.

---

## 6. P2 — Security, Privacy & Updater Gaps

### 6.1 Missing Code Signing Certificate (SmartScreen Blocker)
- Neither `mini_installer.exe` nor the inner binaries (`chrome.exe`, `chrome.dll`, `setup.exe`) are signed with an Authenticode code-signing certificate (`docs/README.md` line 155).
- Windows SmartScreen ("Windows protected your PC") and Windows Defender / EDR heuristics will block or warn users both on initial download and potentially when `prepareUpdate` launches the downloaded `perseu-update-<ver>.exe` from `%TEMP%`.

### 6.2 Privacy Leaks That Contradict the `ungoogled-chromium` Base
Users choosing a browser built on `ungoogled-chromium` generally expect zero unrequested traffic to Google or third parties, yet the shell makes several direct external requests without disclosure or opt-out toggles:
1. **Keystroke leak to Google Autocomplete (`background.ts` lines 1022–1039):** `searchSuggestions()` **always queries `https://suggestqueries.google.com/complete/search?...` first** for every non-URL string typed into the Home search box or Command Bar — **even when the user explicitly changed their search engine to DuckDuckGo, Brave Search, Kagi, or Ecosia!** It only falls back to DuckDuckGo or Bing if Google's endpoint is unreachable.
2. **Direct Favicon Fetching (`siteIcons.ts`):** Directly fetches pages/icons from remote websites in the background (e.g., all 12 onboarding apps — Gmail, Slack, Notion, Linear, GitHub, WhatsApp, etc. — as soon as Onboarding opens in `onboarding.ts` line 765, before the user selects any of them!).
3. **Shazam Audio Fingerprinting (`offscreen.ts` line 16):** Clicking *Identify* captures tab audio via `tabCapture` (patched in `tab_capture_api.cc` to bypass user-gesture restrictions for the shell) and posts signatures to `https://amp.shazam.com/...`.
4. **Chrome Web Store Update Pings (`extension_urls.cc`):** Sends installed Web Store extension IDs and versions to `https://clients2.google.com/service/update2/crx`.

### 6.3 Auto-Updater Limitations
- **Never tested end-to-end on a real release upgrade** (`docs/README.md` line 153).
- **Full-installer downloads only:** Every UI tweak in `flecha/chromium/shell` requires downloading and running a full ~120+ MB Chromium `mini_installer.exe` (no differential/Courgette patches and no signed shell-only update channel).
- **No system-level install support:** `FlechaPrivatePrepareUpdateFunction::OnInstalledChecked` (`flecha_private_api.cc` line 1460) rejects `install_static::IsSystemInstall()` with `"unsupported"`.
- **Single Ed25519 key with no rotation path:** `PUBLIC_KEY` is hardcoded in `features/updates.ts` (line 12) with no secondary/backup key pinned for key rotation.

---

## 7. P3 — Localization (i18n), Accessibility, Testing & Legal Compliance

### 7.1 Localization / Language Inconsistency (No `i18n` System)
- There is **no `_locales/` folder or `chrome.i18n` localization infrastructure** anywhere in `flecha/chromium/shell`.
- **99% of the shell is hardcoded in English** — including `en-US` date/12-hour AM/PM clock on the Home screen (`ui/app.ts` lines 336–337) and `Intl.RelativeTimeFormat('en')` in Archived Tabs (`ui/app.ts` line 1545).
- **Incognito Home card is hardcoded in Portuguese** (`ui/index.html` lines 216–217: *"Modo anônimo — Histórico, cookies e dados de formulários não ficam salvos neste navegador..."*), while the sidebar menu right next to it says `"New Private Window"` / `"New Incognito Window"` in English, and native Chromium dialogs/context menus render in the user's Windows OS language.

### 7.2 Automated Testing & Verification Coverage
- Only **2 unit test files** exist in the entire repository:
  - `flecha/chromium/scripts/update-feed.test.mjs`
  - `flecha/chromium/shell/lib/shazamSignature.test.mjs`
- Neither is wired into `flecha/package.json` (`"test"` script is missing) or GitHub Actions.
- **Zero tests** exist for `Store` state transitions (tabs, folders, Spaces, splits, archive), URL/bang resolution (`lib/url.ts`),Zen theme generation (`lib/zenTheme.ts`), browser import parsing (`shared/importParse.ts`), or Playwright/CDP end-to-end browser flows.

### 7.3 Licensing & Legal Compliance Gaps (Release Blockers)
Before distributing installers publicly, several licensing issues must be resolved:
1. **Unused & Unverified Artwork Still Shipped in Installer (`docs/README.md` line 147):**
   - `flecha/chromium/shell/ui/art-cellini.webp` and `flecha/chromium/shell/ui/art-perseus-medusa.webp` have **unverified copyright/license status** (explicitly flagged in `docs/README.md`). Even though commit `ebef879` replaced the classical-art onboarding with the sky onboarding (none of the 7 `ui/art-*.webp` files or `ui/tour-art.png` are referenced anywhere in `.ts`/`.css`/`.html` anymore), `build.mjs` (line 25) still blindly copies every `.webp` and `.png` in `ui/` into `dist/` — shipping ~755 KB of dead, partly unverified-license images in every installer.
2. **Unattributed Tour / Sky Media Assets:**
   - `flecha/chromium/shell/ui/tour/intro.m4a`, `tour/sky-*.avif`, and `ui/sky/night-*.{avif,jpg}` (noted in comments as coming from Zephium / `perseu.dev`) have no license file in the repository.
   - `flecha/chromium/shell/ui/tour/{mona-sans,martian-mono}.woff2` and `@fontsource-variable/jetbrains-mono` have no bundled OFL license text in `dist/`.
3. **GPL-3.0 Compliance for Modified uBlock Origin:**
   - `flecha/chromium/extensions/fetch.mjs` (lines 17, 55–78) downloads **uBlock Origin (GPL-3.0)**, **patches its source files** (`js/background.js`, `js/start.js`, `manifest.json`), and bundles it inside the installer. Under GPLv3, distributing modified uBlock Origin binaries/packages requires providing uBlock's GPL-3.0 license notice, clear notice of modifications, and corresponding source links.
4. **Root `LICENSE` & Third-Party Credits:**
   - Root `LICENSE` only states `Copyright 2022 The ungoogled-chromium Authors` (BSD-3-Clause), omitting Perseu's own copyright/license, Flecha's MIT license (`flecha/LICENSE`), Zen Browser's MPL-2.0 notice (`flecha/chromium/shell/ui/ZEN-THEME-LICENSE.txt`, which `build.mjs` does **not** copy into `dist/`), and uBlock Origin's GPL-3.0 notice.

---

## 8. Prioritized Action Checklist

### Immediate (Fix Clean Build & Release Integrity)
- [ ] Unify the three `flecha-chromium-157.patch` copies into `patches/flecha/flecha-chromium-157.patch` (or split into clean quilt patches under `patches/perseu/`) and delete the redundant copies.
- [ ] Fix `extensions/common/extension_urls.cc` vs. `domain_substitution.list` ordering in `build.py` (exclude `extension_urls.cc` from `domain_substitution.list` or apply Perseu patches after domain substitution).
- [ ] Update `build.py` / `stage_shell.py` to copy `branding/win/chromium.ico`, `branding/logo/*.png`, `branding/logo-scaled/*`, and `VisualElements` logos into `build/src/chrome/app/theme/`.
- [ ] Add `resources/flecha-shell` and `resources/flecha-extensions` to `chrome/tools/build/win/FILES.cfg` and rename outputs in `package.py` from `ungoogled-chromium_*` to `perseu_*`.
- [ ] Change `"minimum_chrome_version"` in `flecha/chromium/shell/manifest.json` from `"158"` to `"157"`.
- [ ] Remove or disable upstream `.github/workflows/publish-release.yml` (`Nifury` / `eloston.ungoogled-chromium`), add a fast PR workflow for `typecheck` + unit tests + shell build, and validate `perseu-auto.yml` end-to-end.

### High Priority (Fix Windows Bugs & Core UX)
- [ ] Move `readBookmarksHtml` from `nativeHost.ts` into the shell extension directly so **Import Bookmarks HTML File** works on Windows without a native host.
- [ ] Either hide `Settings → Coding Agents` on Windows or build/ship/register `native-host` on Windows (`HKCU\Software\Perseu\NativeMessagingHosts\...`).
- [ ] Wire `extensions::MaybeOpenLinkInFlechinha()` into Windows external URL launch (`StartupBrowserCreatorImpl`) so **"Open links from other apps in a Mini Window"** works on Windows.
- [ ] Fix `background.ts` `Open in Mini Window` context menu item to call `openFlechinha(undefined, tabId)` instead of `openPeek`.
- [ ] Fix `ui/flechinha.ts` `Ctrl+O` handler to check `(e.ctrlKey || e.metaKey)` and replace `⌘` tooltips in `flechinha.html`.
- [ ] Refactor `Store` / `background.ts` to track `activeSpaceId`, `activeTabId`, and `placeholder` **per window** (or disable `New Window` until multi-window state is supported).

### Medium Priority (Features, Privacy & Developer Cleanup)
- [ ] Match `searchSuggestions()` in `background.ts` to the user's selected search engine instead of unconditionally sending queries to Google, and add a toggle for search suggestions.
- [ ] Decide on Phase 5 scope: remove or gate `localServers.ts` (45-port scanner), `consoleHook.ts` (global `MAIN`-world script — restrict `matches` to `http://localhost/*` & `http://127.0.0.1/*` at minimum!), `Environments`, `Boosts`, and `devCommands.ts` behind a **Developer Mode** setting.
- [ ] Restore the progress/seek bar in `renderNowPlaying()` (`ui/app.ts`) or remove the dead `npProgress` timer and `seekMedia` plumbing.
- [ ] Add Default Browser status/button and Downloads folder / "Ask where to save" controls to `Settings → General`, plus an **Export Perseu Backup** button.
- [ ] Render site permission toggles (Camera, Mic, Location, Notifications, Clipboard) in `#site-panel`.
- [ ] Reconcile `Menu → Bookmarks` with Perseu's Spaces/Pinned tabs, and add `Passwords` and `History` (`Ctrl+H`) entries to the browser menu.
- [ ] Add a Widevine CDM installation/enablement path if DRM streaming (Spotify Web, Netflix, etc.) is an intended use case.
- [ ] Obtain an Authenticode code-signing certificate (e.g., SignPath Foundation or Certum Open Source) and sign binaries in CI.

### Polish, Localization & Legal
- [ ] Replace all `"on this Mac"`, `Mail`, and hardcoded `⌘`/`⌥`/`⌃` glyphs in `settings.html`, `settings.ts`, `flechinha.html`, and `features.ts`.
- [ ] Generate a unique `active_setup_guid`, set `direct_launch_url_scheme = "perseu"`, and optionally rename `chrome.exe` → `perseu.exe`.
- [ ] Introduce a proper i18n dictionary (`en` + `pt-BR`) and resolve the English vs. Portuguese split on the Incognito Home screen.
- [ ] Delete the unused `ui/art-*.webp` and `ui/tour-art.png` files (especially unverified `art-cellini.webp` and `art-perseus-medusa.webp`), document `sky/*` and `tour/intro.m4a` licenses, and include BSD + MIT + MPL-2.0 + GPL-3.0 notices in distributions.
