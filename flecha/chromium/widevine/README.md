# Widevine CDM (DRM streaming)

Widevine lets Spotify Web, Netflix, Prime Video, Disney+ and other protected-media
sites play. The CDM itself is **free** from Google: there is no fee — you register
once, sign the CDM license agreement, and download the signed binaries.

## Getting the binaries

1. Register at <https://www.widevine.com/contact> (Widevine portal; free).
2. After approval, download the Widevine CDM for Windows x64 (and x86 / arm64 if wanted).
3. Copy the files into this folder:

   ```
   flecha/chromium/widevine/win/x64/widevinecdm.dll
   flecha/chromium/widevine/win/x64/widevinecdm.dll.sig   (if provided)
   flecha/chromium/widevine/win/x64/manifest.json
   flecha/chromium/widevine/win/x64/LICENSE
   ```

   (same layout for `win/x86/` and `win/arm64/` if you want those targets)

## What the build does

`build.py` checks `flecha/chromium/widevine/win/<arch>/widevinecdm.dll` and, when it
is there, copies the folder into the source tree (`third_party/widevine/cdm/win/<arch>/`)
and appends the GN args `enable_widevine=true`, `bundle_widevine_cdm=true`,
`ignore_missing_widevine_signing_cert=true`. The CDM lands in `out/Default/WidevineCdm/…`,
which `chrome/tools/build/win/FILES.cfg` already lists for official builds, so the
installer and the portable `.zip` pick it up with no further changes.

Without the binaries nothing changes — the build stays DRM-free, as the
ungoogled-chromium base ships it.

## Caveats

- `args.gn` is only rewritten when `out/Default` does not exist (or in non-CI mode).
  After adding the binaries, delete `build/src/out/Default/args.gn` (or the whole
  `out/Default`) so the widevine flags take effect, then rebuild.
- The runtime component-updater route (fetching the CDM from Google on first DRM
  site) was deliberately **not** taken: it would reintroduce automatic Google
  traffic into an ungoogled build.
