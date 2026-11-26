import lib from './korean-lib.cjs';
const SB = 0xAC00;
const dec = c => { const n = c.charCodeAt(0) - SB; return { l: Math.floor(n / 588), v: Math.floor((n % 588) / 28), t: n % 28 }; };
const enc = ({ l, v, t }) => String.fromCharCode(SB + l * 588 + v * 28 + t);
const isSyl = c => c && c.charCodeAt(0) >= SB && c.charCodeAt(0) <= 0xD7A3;
// jongseong indexes: ㅎ=27, ㄶ=6, ㅀ=15, ㄴ=4, ㄹ=8, ㄷ=7, ㅌ=25 ; choseong: ㅇ=11, ㅈ=12, ㅊ=14 ; vowel ㅣ=20
// Pronunciation fixes applied before RR so the output matches how it is sung.
function soundFix(word) {
  const a = [...word];
  for (let i = 0; i < a.length - 1; i++) {
    if (!isSyl(a[i]) || !isSyl(a[i + 1])) continue;
    const x = dec(a[i]), y = dec(a[i + 1]);
    if (y.l !== 11) continue;                       // next syllable starts with silent ㅇ
    if (x.t === 27) x.t = 0;                         // 좋아 -> 조아 (joa)
    else if (x.t === 6) x.t = 4;                     // 많이 -> 만이 (mani)
    else if (x.t === 15) x.t = 8;                    // 싫어 -> 실어 (sireo)
    else if (x.t === 25 && y.v === 20) { x.t = 0; y.l = 14; } // 같이 -> 가치 (gachi)
    else continue;
    a[i] = enc(x); a[i + 1] = enc(y);
  }
  return a.join('');
}
export function romanizeKorean(text) {
  return text.replace(/[가-힣]+/g, w => lib.romanize(soundFix(w)));
}
