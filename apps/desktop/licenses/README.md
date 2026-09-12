# Bundled Node runtime license

`node-22.22.0-LICENSE.txt` is the unmodified [Node.js v22.22.0 license](https://github.com/nodejs/node/blob/v22.22.0/LICENSE), including its third-party notices.

- Source: `https://raw.githubusercontent.com/nodejs/node/v22.22.0/LICENSE`
- SHA-256: `e991d81497a85bb24fc6bffae0a3637a6accd6c6bc5ce1f2c5698bd555cf9d49`

The Windows `node-win-x64@22.22.0` npm package contains only its executable and package metadata. The desktop build therefore copies this checked-in license to `dist/runtime/LICENSE` on every platform. Packaging already includes that directory.

When changing the pinned `node` dependency, update the build's runtime version, this upstream license and its recorded hash together. The build regression and `scripts/check-runtime.mjs` check the bundled result. Keep the license's LF line endings so Windows checkout settings do not change its bytes.

# Bundled font licenses

The desktop imports three [Fontsource](https://fontsource.org/) packages (`apps/desktop/src/renderer/main.tsx`), each licensed under the [SIL Open Font License, Version 1.1](https://scripts.sil.org/OFL). Every `*-OFL.txt` here is the unmodified `LICENSE` file from the installed npm package at the version this build pins.

| Font | Package | Pinned version | License file | SHA-256 |
|---|---|---|---|---|
| Caveat | `@fontsource/caveat` | 5.2.8 | `caveat-OFL.txt` | `163a2b400e16916ad3196296c946c526d0efce6baf22a2164269ffc62fb9f671` |
| Instrument Sans | `@fontsource/instrument-sans` | 5.3.0 | `instrument-sans-OFL.txt` | `c27a3c53c3beed7f5c26853afa15991478ff7145d3754a36b0382f84e10c0d03` |
| JetBrains Mono | `@fontsource/jetbrains-mono` | 5.2.8 | `jetbrains-mono-OFL.txt` | `403581b69dac5cff4079205e01c6b467e56af449ecbd7247693ddb1baafa005b` |

When a pinned `@fontsource/*` version changes, refresh its license file and hash here from the newly installed package.
