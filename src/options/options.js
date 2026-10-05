/**
 * options.js — profile editor: render profile → form, collect form → profile,
 * repeatable lists, resume upload (base64), import/export JSON.
 */
(() => {
  const WDA = globalThis.WDA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const RESUME_WARN_BYTES = 3 * 1024 * 1024;

  /** Repeatable list definitions: profile path + field layout. */
  const LISTS = {
    authorizations: {
      path: 'workAuth.authorizations',
      title: 'Country',
      fields: [
        { k: 'country', label: 'Country', ph: 'Canada' },
        { k: 'authorized', label: 'Legally authorized to work', type: 'yesno' },
        { k: 'sponsorship', label: 'Will require sponsorship', type: 'yesno' },
      ],
    },
    experience: {
      path: 'experience',
      title: 'Experience',
      fields: [
        { k: 'title', label: 'Job title' },
        { k: 'company', label: 'Company' },
        { k: 'location', label: 'Location', ph: 'Toronto, ON' },
        { k: 'current', label: 'I currently work here', type: 'checkbox' },
        { k: 'startMonth', label: 'Start month', type: 'month' },
        { k: 'startYear', label: 'Start year', type: 'year' },
        { k: 'endMonth', label: 'End month', type: 'month' },
        { k: 'endYear', label: 'End year', type: 'year' },
        { k: 'description', label: 'Description', type: 'textarea' },
      ],
    },
    education: {
      path: 'education',
      title: 'Education',
      fields: [
        { k: 'school', label: 'School' },
        { k: 'degree', label: 'Degree', ph: "Bachelor's Degree" },
        { k: 'fieldOfStudy', label: 'Field of study', ph: 'Computer Science' },
        { k: 'gpa', label: 'GPA', ph: 'optional' },
        { k: 'startMonth', label: 'Start month', type: 'month' },
        { k: 'startYear', label: 'Start year', type: 'year' },
        { k: 'endMonth', label: 'End month', type: 'month' },
        { k: 'endYear', label: 'End year', type: 'year' },
        { k: 'expected', label: 'End date is expected', type: 'checkbox' },
      ],
    },
    languages: {
      path: 'languages',
      title: 'Language',
      fields: [
        { k: 'language', label: 'Language', ph: 'English' },
        { k: 'proficiency', label: 'Proficiency', ph: 'Fluent|Native|Advanced' },
        { k: 'fluent', label: 'I am fluent', type: 'checkbox' },
      ],
    },
    savedAnswers: {
      path: 'savedAnswers',
      title: 'Answer',
      fields: [
        { k: 'keywords', label: 'Keywords (comma-separated)', ph: 'sponsorship, visa' },
        { k: 'answer', label: 'Answer', ph: 'No' },
      ],
    },
  };

  const DISCLOSURES = [
    ['gender', 'Gender'],
    ['hispanicLatino', 'Hispanic or Latino'],
    ['ethnicity', 'Ethnicity / race'],
    ['veteran', 'Veteran status'],
    ['disability', 'Disability'],
  ];

  let resume = null;
  let dirty = false;

  /* ---------- path helpers ---------- */

  const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  function setPath(o, path, v) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((a, k) => (a[k] = a[k] && typeof a[k] === 'object' ? a[k] : {}), o);
    target[last] = v;
  }

  function readEl(el) {
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    if (el.dataset.type === 'list') return el.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    return el.value.trim();
  }
  function writeEl(el, v) {
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.dataset.type === 'list') el.value = (v || []).join('\n');
    else el.value = v ?? '';
  }

  /* ---------- messages ---------- */

  let msgTimer = null;
  function message(text, kind = '') {
    const m = $('#msg');
    m.textContent = text;
    m.className = `msg ${kind}`;
    clearTimeout(msgTimer);
    if (kind === 'ok') msgTimer = setTimeout(() => updateDirty(), 2500);
  }
  function updateDirty() {
    const m = $('#msg');
    m.className = 'msg';
    m.textContent = dirty ? 'Unsaved changes' : '';
  }
  function markDirty() {
    dirty = true;
    updateDirty();
  }

  /* ---------- list rows ---------- */

  function fieldInput(f, value) {
    let el;
    if (f.type === 'yesno') {
      el = document.createElement('select');
      el.innerHTML = '<option value=""></option><option>Yes</option><option>No</option>';
    } else if (f.type === 'month') {
      el = document.createElement('select');
      el.innerHTML = MONTHS.map((m, i) => `<option value="${i || ''}">${m}</option>`).join('');
    } else if (f.type === 'textarea') {
      el = document.createElement('textarea');
      el.rows = 3;
    } else {
      el = document.createElement('input');
      if (f.type === 'checkbox') el.type = 'checkbox';
      if (f.type === 'year') {
        el.inputMode = 'numeric';
        el.placeholder = 'YYYY';
        el.maxLength = 4;
      }
      if (f.ph) el.placeholder = f.ph;
    }
    el.dataset.f = f.k;
    writeEl(el, f.type === 'month' ? String(value || '') : value);
    const label = document.createElement('label');
    if (f.type === 'checkbox') {
      label.className = 'check';
      label.append(el, document.createTextNode(f.label));
    } else {
      label.append(document.createTextNode(f.label), el);
    }
    if (f.type === 'textarea') label.classList.add('wide');
    return label;
  }

  function renumber(key) {
    $$(`[data-list="${key}"] .row`).forEach((row, i) => {
      $('.row-num', row).textContent = `${LISTS[key].title} ${i + 1}`;
    });
  }

  function renderRow(key, item) {
    const cfg = LISTS[key];
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div class="row-head"><span class="row-num"></span>
      <span class="row-tools"><button data-act="up" title="Move up">↑</button><button data-act="down" title="Move down">↓</button><button data-act="remove" title="Remove">✕</button></span></div>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    cfg.fields.forEach((f) => grid.appendChild(fieldInput(f, item[f.k])));
    row.appendChild(grid);
    row.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      if (act === 'remove') row.remove();
      if (act === 'up' && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
      if (act === 'down' && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
      renumber(key);
      markDirty();
    });
    return row;
  }

  function renderList(key, items) {
    const wrap = $(`[data-list="${key}"]`);
    wrap.innerHTML = '';
    items.forEach((item) => wrap.appendChild(renderRow(key, item)));
    renumber(key);
  }

  function collectList(key) {
    const cfg = LISTS[key];
    return $$(`[data-list="${key}"] .row`)
      .map((row) => {
        const o = {};
        cfg.fields.forEach((f) => (o[f.k] = readEl($(`[data-f="${f.k}"]`, row))));
        return o;
      })
      .filter((o) => cfg.fields.some((f) => f.type !== 'checkbox' && f.type !== 'yesno' && o[f.k]));
  }

  /* ---------- disclosures ---------- */

  function renderDisclosures(d) {
    const wrap = $('#disclosures');
    wrap.innerHTML = '';
    for (const [key, label] of DISCLOSURES) {
      const row = document.createElement('div');
      row.className = 'disc-row';
      row.innerHTML = `<span>${label}</span>
        <select data-k="disclosures.${key}.mode">
          <option value="decline">Decline to answer</option>
          <option value="blank">Leave blank</option>
          <option value="answer">Answer…</option>
        </select>
        <input data-k="disclosures.${key}.answer" placeholder="Option text, e.g. Male / No" />`;
      wrap.appendChild(row);
      const sel = $('select', row);
      const inp = $('input', row);
      sel.value = d[key].mode || 'decline';
      inp.value = d[key].answer || '';
      const sync = () => (inp.style.visibility = sel.value === 'answer' ? 'visible' : 'hidden');
      sel.addEventListener('change', sync);
      sync();
    }
  }

  /* ---------- resume ---------- */

  function renderResume() {
    $('#resumeInfo').textContent = resume ? `${resume.name} (${Math.round(resume.size / 1024)} KB)` : 'No resume saved.';
    $('#resumeRemove').hidden = !resume;
  }

  $('#resumeFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      resume = { name: file.name, type: file.type || 'application/pdf', size: file.size, data: String(reader.result).split(',')[1] };
      renderResume();
      markDirty();
      if (file.size > RESUME_WARN_BYTES) message('Resume is over 3 MB; it may not fit in browser storage.', 'err');
    };
    reader.onerror = () => message('Could not read that file.', 'err');
    reader.readAsDataURL(file);
  });
  $('#resumeRemove').addEventListener('click', () => {
    resume = null;
    renderResume();
    markDirty();
  });

  /* ---------- render / collect ---------- */

  function render(profile, settings) {
    $$('[data-k]').forEach((el) => {
      if (!el.closest('#disclosures')) writeEl(el, getPath(profile, el.dataset.k));
    });
    for (const key of Object.keys(LISTS)) renderList(key, getPath(profile, LISTS[key].path) || []);
    renderDisclosures(profile.disclosures);
    resume = profile.resume;
    renderResume();
    if (settings) $$('[data-s]').forEach((el) => writeEl(el, settings[el.dataset.s]));
  }

  function collect() {
    const p = WDA.defaultProfile();
    $$('[data-k]').forEach((el) => setPath(p, el.dataset.k, readEl(el)));
    for (const key of Object.keys(LISTS)) setPath(p, LISTS[key].path, collectList(key));
    p.resume = resume;
    return WDA.normalizeProfile(p);
  }

  async function save() {
    try {
      await WDA.storage.saveProfile(collect());
      const s = {};
      $$('[data-s]').forEach((el) => (s[el.dataset.s] = readEl(el)));
      await WDA.storage.saveSettings(s);
      dirty = false;
      message('Saved ✓', 'ok');
    } catch (e) {
      message(`Save failed: ${e.message}`, 'err');
    }
  }

  /* ---------- import / export ---------- */

  function exportJson() {
    const data = { app: 'workday-autofill', version: 1, exportedAt: new Date().toISOString(), profile: collect() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `workday-profile-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const profile = WDA.normalizeProfile(data.profile || data);
      render(profile);
      await save();
      message('Imported and saved ✓', 'ok');
    } catch (err) {
      message(`Import failed: ${err.message}`, 'err');
    }
  });

  /* ---------- wiring ---------- */

  $$('[data-add]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.add;
      $(`[data-list="${key}"]`).appendChild(renderRow(key, WDA.blankEntry[key]()));
      renumber(key);
      markDirty();
    })
  );
  $('#save').addEventListener('click', save);
  $('#export').addEventListener('click', exportJson);
  $('#import').addEventListener('click', () => $('#importFile').click());
  document.addEventListener('input', (e) => {
    if (e.target.closest('main')) markDirty();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  (async () => {
    const [profile, settings] = await Promise.all([WDA.storage.getProfile(), WDA.storage.getSettings()]);
    render(profile, settings);
  })();
})();
