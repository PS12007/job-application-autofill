/**
 * sections.js — repeatable sections (Work Experience, Education, Languages, Websites):
 * find the section, count its blocks, click "Add"/"Add Another" when more are needed,
 * and fill each block scoped to its own container.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  const S = () => WDA.SELECTORS;

  function findAddButton(scope) {
    const A = S().addButton;
    const btns = [...scope.querySelectorAll('button, [role="button"]')].filter((b) => {
      if (!WDA.isVisible(b)) return false;
      const aid = b.getAttribute('data-automation-id') || '';
      const text = WDA.clean(b.innerText);
      const aria = WDA.clean(b.getAttribute('aria-label') || '');
      return A.ids.includes(aid) || A.text.test(text) || (!text && A.ariaText.test(aria));
    });
    return btns[btns.length - 1] || null;
  }

  WDA.findSection = (cfg) => {
    for (const id of cfg.ids || []) {
      const el = document.querySelector(`[data-automation-id="${id}"]`);
      if (el && WDA.isVisible(el)) return el;
    }
    for (const g of document.querySelectorAll('[role="group"][aria-labelledby], section[aria-labelledby]')) {
      if (cfg.heading.test(WDA.textOfIds(g.getAttribute('aria-labelledby'))) && WDA.isVisible(g)) return g;
    }
    // Heading → nearest ancestor that also contains an Add button
    for (const h of document.querySelectorAll('h2, h3, h4, [role="heading"]')) {
      if (!WDA.isVisible(h) || !cfg.heading.test(WDA.clean(h.innerText))) continue;
      for (let node = h.parentElement; node && node !== document.body; node = node.parentElement) {
        if (findAddButton(node)) return node;
      }
    }
    return null;
  };

  const outermost = (els) => els.filter((el) => !els.some((o) => o !== el && o.contains(el)));

  WDA.getBlocks = (section, cfg) => {
    // 1) data-automation-id / id like "workExperience-3"
    let blocks = [...section.querySelectorAll('[data-automation-id], [id]')].filter(
      (el) => cfg.blockIdPattern.test(el.getAttribute('data-automation-id') || '') || cfg.blockIdPattern.test(el.id || '')
    );
    blocks = outermost(blocks).filter(WDA.isVisible);
    if (blocks.length) return blocks;

    // 2) role=group labelled "Work Experience 2"
    blocks = [...section.querySelectorAll('[role="group"][aria-labelledby]')].filter((g) =>
      cfg.blockHeading.test(WDA.textOfIds(g.getAttribute('aria-labelledby')))
    );
    if (blocks.length) return outermost(blocks);

    // 3) heading "Work Experience 2" → widest ancestor holding only that one heading
    const heads = [...section.querySelectorAll('h3, h4, h5, h6, [role="heading"]')].filter((h) =>
      cfg.blockHeading.test(WDA.clean(h.innerText))
    );
    const count = (el) => heads.filter((h) => el.contains(h)).length;
    return heads.map((h) => {
      let node = h;
      while (node.parentElement && node.parentElement !== section && count(node.parentElement) === 1) node = node.parentElement;
      return node;
    });
  };

  async function addBlock(cfg, before) {
    const section = WDA.findSection(cfg);
    const btn = section && findAddButton(section);
    if (!btn) return false;
    WDA.log(`clicking "${WDA.clean(btn.innerText) || 'Add'}" to create block ${before + 1}`);
    WDA.safeClick(btn);
    return !!(await WDA.waitFor(
      () => {
        const s = WDA.findSection(cfg);
        return s && WDA.getBlocks(s, cfg).length > before;
      },
      { timeout: 6000 }
    ));
  }

  /**
   * Fill `entries` into the section `key`. fillBlock(getBlock, entry, tag) is called per
   * entry; getBlock() returns the current DOM node for that block even after re-renders.
   */
  WDA.fillRepeatable = async (ctx, key, entries, fillBlock) => {
    const cfg = S().sections[key];
    if (!entries || !entries.length) return;
    if (!WDA.findSection(cfg)) {
      WDA.log(`section "${key}" not found on this page`);
      return;
    }
    for (let i = 0; i < entries.length; i++) {
      const tag = `${key} ${i + 1}`;
      let blocks = WDA.getBlocks(WDA.findSection(cfg), cfg);
      if (blocks.length <= i) {
        const added = await WDA.withTimeout(addBlock(cfg, blocks.length), 8000, 'add timed out').catch(() => false);
        if (!added) {
          ctx.record(tag, null, { status: 'failed', reason: 'could not add a new block' });
          break;
        }
        await WDA.waitForSettle(250, 1500);
      }
      const getBlock = () => {
        const s = WDA.findSection(cfg);
        return s ? WDA.getBlocks(s, cfg)[i] || null : null;
      };
      if (!getBlock()) break;
      WDA.log(`filling ${tag}`, getBlock());
      await fillBlock(getBlock, entries[i], tag);
    }
  };
})();
