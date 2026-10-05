/**
 * match.js — text normalisation and "best option" matching.
 *
 * Matching order for a wanted value: exact text → case-insensitive → option starts
 * with value → option contains value (whole words) → option has a word starting with
 * value → value contains option. A value may list alternatives separated by "|"
 * ("Bachelor's Degree|Bachelors"); they are tried in order. The special value
 * "__decline__" matches any "decline / prefer not to answer" option.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  WDA.norm = (s) =>
    String(s ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/['‘’`]/g, '')
      .replace(/[^a-z0-9+]+/g, ' ')
      .trim();

  const shortest = (arr) => arr.reduce((a, b) => (b.n.length < a.n.length ? b : a));
  const longest = (arr) => arr.reduce((a, b) => (b.n.length > a.n.length ? b : a));

  function matchOne(items, value, getText) {
    const list = items
      .map((it) => {
        const raw = WDA.clean(getText(it));
        return { it, raw, n: WDA.norm(raw) };
      })
      .filter((x) => x.raw);

    if (value === '__decline__') {
      const hit = list.find((x) => WDA.SELECTORS.declinePatterns.some((p) => p.test(x.raw)));
      return hit ? hit.it : null;
    }

    const v = String(value).trim();
    const nv = WDA.norm(v);
    if (!nv) return null;

    let hit = list.find((x) => x.raw === v) || list.find((x) => x.n === nv);
    if (hit) return hit.it;

    const starts = list.filter((x) => x.n.startsWith(nv + ' '));
    if (starts.length) return shortest(starts).it;

    const contains = list.filter((x) => ` ${x.n} `.includes(` ${nv} `));
    if (contains.length) return shortest(contains).it;

    if (nv.length >= 4) {
      const wordPrefix = list.filter((x) => ` ${x.n}`.includes(` ${nv}`));
      if (wordPrefix.length) return shortest(wordPrefix).it;
    }

    const reverse = list.filter((x) => x.n.length >= 3 && ` ${nv} `.includes(` ${x.n} `));
    if (reverse.length) return longest(reverse).it;

    return null;
  }

  /**
   * "a|b" → ['a', 'b'], plus any built-in synonyms (selectors.js → synonyms) of each
   * alternative, appended after the user's own alternatives.
   */
  WDA.expandAlternatives = (value) => {
    const own = String(value ?? '').split('|').map((s) => s.trim()).filter(Boolean);
    const out = [...own];
    const seen = new Set(own.map(WDA.norm));
    for (const alt of own) {
      const n = WDA.norm(alt);
      const group = (WDA.SELECTORS.synonyms || []).find((g) => g.some((s) => WDA.norm(s) === n));
      for (const s of group || []) {
        if (!seen.has(WDA.norm(s))) {
          seen.add(WDA.norm(s));
          out.push(s);
        }
      }
    }
    return out;
  };

  /** Pick the item whose text best matches value, or null. */
  WDA.bestMatch = (items, value, getText = (x) => (typeof x === 'string' ? x : x.text)) => {
    if (value === true) value = 'Yes';
    if (value === false) value = 'No';
    if (value == null) return null;
    const alts = value === '__decline__' ? [value] : WDA.expandAlternatives(value);
    for (const alt of alts) {
      const m = matchOne(items, alt, getText);
      if (m) return m;
    }
    return null;
  };

  WDA.isPlaceholder = (text) => WDA.SELECTORS.placeholder.test(WDA.clean(text));

  WDA.isYes = (v) => v === true || /^(y|yes|true|1|checked|on)$/i.test(String(v ?? '').trim());

  /** First alternative of a "a|b|c" value (for plain text fields). */
  WDA.firstAlt = (v) => String(v ?? '').split('|')[0].trim();

  /**
   * Saved answers: a pair matches when any of its comma-separated keywords appears
   * (case-insensitive substring) in the question. Most / longest keyword hits win.
   */
  WDA.matchSavedAnswer = (question, savedAnswers) => {
    const q = String(question || '').toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const sa of savedAnswers || []) {
      if (!String(sa.answer ?? '').trim()) continue;
      const kws = String(sa.keywords || '')
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      const hits = kws.filter((k) => q.includes(k));
      if (!hits.length) continue;
      const score = hits.length * 1000 + hits.reduce((a, k) => a + k.length, 0);
      if (score > bestScore) {
        best = sa;
        bestScore = score;
      }
    }
    return best;
  };

  WDA.shortLabel = (label, max = 60) => {
    const t = WDA.clean(label);
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  };
})();
