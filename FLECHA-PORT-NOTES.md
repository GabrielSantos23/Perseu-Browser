# Flecha on ungoogled-chromium 157 (Windows) — phase 3 state

Source: D:\projects\flecha-browser (Chromium 158 patches), applied to C:\uc\build\src (157.0.8103.38).
LF patch copies: C:\uc\flecha-patches-lf (the D: clone has core.autocrlf=true, so its working-tree patches are CRLF and do not apply).
Backup of the 53 pre-existing files the patches touch: C:\uc\pre-flecha-backup.tar (restore: cd build\src && tar -xf ..\..\pre-flecha-backup.tar, then delete the new flecha files listed in C:\uc\flecha-touched.txt).

## Applied
- Clean: 0001-0006, 0010, 0015, 0017, 0020, 0022, 0025, 0028, 0029, 0031, 0038, 0040, 0051, 0054.
- With reduced context (-C1): 0011, 0013, 0014, 0016, 0018, 0019, 0021, 0023, 0024, 0026, 0027, 0030, 0034, 0039, 0041, 0042, 0050, 0052.
- Ported by hand to 157:
  - 0009: include of flecha_top_chrome.h in browser_command_controller.cc.
  - 0032: incognito dark shell in chrome_content_browser_client.cc (157 uses `profile->`).
  - 0033: Peek reload in render_view_context_menu.cc.
  - 0035: always --no-first-run in chrome_main_delegate.cc.
  - 0053: Mac-only Sparkle bundle_deps in chrome/BUILD.gn.
  - WindowOpenDisposition::kFooBar -> FOO_BAR (157 naming) in flecha_frame_view.cc and browser_web_contents_delegate.cc.

## Skipped on purpose
- 0012 hunk in components/remote_cocoa/.../browser_native_widget_window_mac.mm (macOS traffic lights; phase 4).
- 0036: ungoogled-chromium already removes the Google API keys infobar.
- 0037: Help -> flecha.dev (not this browser's site).

## Kept although "developer" features
- 0027 (shell opens DevTools, set-as-default-browser) and 0031 (DevTools console): without them F12/Ctrl+Shift+I break, because the shell owns keyboard shortcuts.
- Developer-only shell features (gh/npm/mdn shortcuts, JWT, MCP) live in the TS shell; remove in phase 5.

## Run
chrome.exe --flecha-shell-dir=D:\projects\flecha-browser\chromium\shell\dist --user-data-dir=%TEMP%\flecha-test --no-first-run
