// Romanization for Japanese, Korean and Chinese lyric lines.
// Korean, Chinese and the kana->romaji step come from vendor/libs.js (window.LyricLibs).
// Japanese needs the kuromoji dictionary (~12 MB), which is loaded only when a Japanese song appears.
(() => {
  const L = () => window.LyricLibs;

  const RE_HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
  const RE_KANA = /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]/;
  const RE_HAN = /[㐀-䶿一-鿿豈-﫿]/;
  const RE_CJK_ANY = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힣ᄀ-ᇿ㄰-㆏]/;

  // Decide the language of a whole song: Han characters are ambiguous between
  // Japanese and Chinese, so any kana anywhere in the song means Japanese.
  function detectSong(lines) {
    const all = lines.join('\n');
    return {
      ja: RE_KANA.test(all),
      ko: RE_HANGUL.test(all),
      zh: RE_HAN.test(all) && !RE_KANA.test(all),
    };
  }

  function lineLang(text, song) {
    if (RE_HANGUL.test(text)) return 'ko';
    if (RE_KANA.test(text)) return 'ja';
    if (RE_HAN.test(text)) return song.ja ? 'ja' : 'zh';
    return null; // Latin text, numbers, empty lines: shown as-is
  }

  const PUNCT = { '、': ',', '，': ',', '。': '.', '．': '.', '！': '!', '？': '?', '「': '"', '」': '"', '『': '"', '』': '"', '（': '(', '）': ')', '：': ':', '；': ';', '～': '~', '〜': '~', '…': '…', '・': ' ', '　': ' ', '“': '"', '”': '"' };
  const fixPunct = s => s.replace(/[、，。．！？「」『』（）：；～〜…・　“”]/g, c => PUNCT[c]);
  const tidy = s => fixPunct(s)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?)~…:;])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .trim();

  // ---------- Korean ----------
  function korean(text) {
    return tidy(L().romanizeKorean(text));
  }

  // ---------- Chinese (Mandarin pinyin) ----------
  function chinese(text, opts) {
    const simp = L().t2s(text); // pinyin-pro reads simplified characters more accurately
    const out = L().pinyin(simp, {
      toneType: opts.tones === 'none' ? 'none' : 'symbol',
      type: 'string',
      nonZh: 'consecutive',
    });
    return tidy(out);
  }

  // ---------- Japanese ----------
  let tokenizer = null;
  let jaLoading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function loadJapanese() {
    if (tokenizer) return Promise.resolve();
    if (jaLoading) return jaLoading;
    jaLoading = (async () => {
      if (!window.kuromoji) await loadScript('vendor/kuromoji.min.js');
      tokenizer = await new Promise((resolve, reject) => {
        window.kuromoji.builder({ dicPath: 'vendor/dict/' }).build((err, t) => (err ? reject(err) : resolve(t)));
      });
    })();
    jaLoading.catch(() => { jaLoading = null; });
    return jaLoading;
  }

  const VERBISH = new Set(['動詞', '形容詞', '助動詞']);
  const TE_FORM = new Set(['て', 'で', 'ば', 'ちゃ', 'じゃ', 'たり', 'だり']);

  // Should this token be glued to the previous one to make a sung "word"?
  function attaches(tok, prev) {
    if (!prev || prev.pos === '記号') return false;
    if (tok.pos_detail_1 === '接尾') return true;                                   // suffixes: さん, たち
    if (tok.pos === '助動詞') return VERBISH.has(prev.pos);                         // 行こ+う, よかっ+た
    if (tok.pos === '動詞' && (tok.pos_detail_1 === '非自立' || tok.pos_detail_1 === '接尾'))
      return VERBISH.has(prev.pos) || prev.pos_detail_1 === '接続助詞';             // して+いる, て+る
    if (tok.pos === '助詞' && tok.pos_detail_1 === '接続助詞' && TE_FORM.has(tok.surface_form))
      return VERBISH.has(prev.pos);                                                // 繋い+で
    return false;
  }

  function kanaOf(tok) {
    if (tok.pos === '助詞') {                    // particles are written は/へ/を but sung wa/e/o
      if (tok.surface_form === 'は') return 'ワ';
      if (tok.surface_form === 'へ') return 'エ';
      if (tok.surface_form === 'を') return 'オ';
    }
    if (tok.reading && tok.reading !== '*') return tok.reading;
    return tok.surface_form;                     // Latin words, numbers, unknown kana
  }

  function japanese(text) {
    if (!tokenizer) return null; // dictionary still loading
    const { toRomaji } = L().wanakana;
    const toks = tokenizer.tokenize(text);
    const words = [];
    let prev = null;
    for (const tok of toks) {
      if (tok.pos === '記号') {
        words.push({ punct: true, text: tok.surface_form });
      } else {
        const kana = kanaOf(tok);
        if (attaches(tok, prev) && words.length && !words[words.length - 1].punct) words[words.length - 1].text += kana;
        else words.push({ text: kana });
      }
      prev = tok;
    }
    const out = words.map(w => {
      if (w.punct) return /^\s+$/.test(w.text) ? ' ' : ' ' + w.text;
      return ' ' + toRomaji(w.text, { upcaseKatakana: false });
    }).join('');
    return tidy(out);
  }

  // Returns romanized text, '' for nothing to romanize, or null while Japanese is still loading.
  function romanizeLine(text, song, opts) {
    if (!text || !RE_CJK_ANY.test(text)) return '';
    const lang = lineLang(text, song);
    try {
      if (lang === 'ko') return korean(text);
      if (lang === 'zh') return chinese(text, opts);
      if (lang === 'ja') return japanese(text);
    } catch (e) {
      console.warn('romanize failed', e);
    }
    return '';
  }

  window.Romanizer = { detectSong, romanizeLine, loadJapanese, japaneseReady: () => !!tokenizer, hasCJK: t => RE_CJK_ANY.test(t) };
})();
