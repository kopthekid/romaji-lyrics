import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js/t2cn';
import { romanizeKorean } from './korean.mjs';
import * as wanakana from 'wanakana';
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
window.LyricLibs = { pinyin, t2s, romanizeKorean, wanakana };
