# Third-party code

| File | Package | Version | License |
|---|---|---|---|
| `vendor/libs.js` | [pinyin-pro](https://github.com/zh-lx/pinyin-pro) | 3.29.5 | MIT |
| `vendor/libs.js` | [opencc-js](https://github.com/nk2028/opencc-js) (t2cn) | 1.4.2 | MIT and Apache-2.0 |
| `vendor/libs.js` | [wanakana](https://github.com/WaniKani/WanaKana) | 5.3.1 | MIT |
| `vendor/libs.js` | [@romanize/korean](https://www.npmjs.com/package/@romanize/korean) | 0.1.3 | MIT |
| `vendor/kuromoji.min.js` | [kuromoji](https://github.com/takuyaa/kuromoji.js) | 0.1.2 | Apache-2.0 |
| `vendor/dict/*` | kuromoji dictionary (from mecab-ipadic) | 0.1.2 | Apache-2.0 / IPADIC license |

`vendor/libs.js` is an esbuild bundle of the packages above plus a small Korean pronunciation pre-pass (silent ㅎ, ㅌ+이 → 치).

`vendor/kuromoji.min.js` is `kuromoji/build/kuromoji.js` with one change: the browser dictionary loader skips gunzip when the server already decompressed the `.gz` file (some hosts send it with `Content-Encoding: gzip`).

Lyrics come from [LRCLIB](https://lrclib.net) at runtime; none are stored in this repo.
