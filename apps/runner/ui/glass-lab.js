(() => {
  const params = new URLSearchParams(location.search);
  const kind = params.get('kind') || 'acrylic';

  /**
   * 各模式可调参数不同：
   * - 系统材质：叠色 / 面板 / 描边（模糊半径系统不开放）
   * - CSS clip：再加圆角半径
   * - 纯 CSS：叠色 / 模糊 / 饱和度 / 圆角（桌面模糊通常无效）
   */
  const META = {
    acrylic: {
      title: 'Acrylic + OS 圆角',
      tag: 'transparent + acrylic + roundedCorners',
      desc: '系统 Acrylic 糊桌面。可调叠色/面板/描边；系统模糊半径不可调。',
      notes: ['需 Win11「透明度效果」', '没有「系统模糊」滑块是正常的'],
      bodyClass: 'os-round',
      knobs: ['shell', 'panel', 'border'],
      defaults: { shell: 14, panel: 22, border: 28 },
    },
    mica: {
      title: 'Mica + OS 圆角',
      tag: 'mica + roundedCorners',
      desc: '系统 Mica。可调叠色/面板/描边；模糊由系统定。',
      notes: ['偏壁纸取色，雾感通常比 Acrylic 轻'],
      bodyClass: 'os-round',
      knobs: ['shell', 'panel', 'border'],
      defaults: { shell: 10, panel: 18, border: 28 },
    },
    tabbed: {
      title: 'Tabbed + OS 圆角',
      tag: 'tabbed (Mica Alt)',
      desc: 'Tabbed / Mica Alt。可调叠色/面板/描边。',
      notes: ['和标准 Mica 层次感不同'],
      bodyClass: 'os-round',
      knobs: ['shell', 'panel', 'border'],
      defaults: { shell: 14, panel: 22, border: 28 },
    },
    'acrylic-clip': {
      title: 'Acrylic + CSS clip',
      tag: 'acrylic + clip-path',
      desc: '系统 Acrylic + CSS 裁圆角。可调叠色/面板/描边/圆角半径。',
      notes: ['圆角外灰尖 = Acrylic 未跟着裁'],
      bodyClass: 'clip-round',
      knobs: ['shell', 'panel', 'border', 'radius'],
      defaults: { shell: 14, panel: 22, border: 28, radius: 10 },
    },
    'css-only': {
      title: '纯 CSS（对照）',
      tag: 'material none',
      desc: '无系统材质。可调叠色/CSS模糊/饱和度/圆角；桌面模糊通常无效。',
      notes: ['若只见透不见雾，说明此路不通'],
      bodyClass: 'clip-round',
      knobs: ['shell', 'blur', 'saturate', 'radius'],
      defaults: { shell: 50, blur: 4, saturate: 100, radius: 10 },
    },
  };

  const KNOB_UI = {
    shell: { label: '外壳不透明度', unit: '%', min: 5, max: 100, step: 1 },
    panel: { label: '面板不透明度', unit: '%', min: 5, max: 100, step: 1 },
    border: { label: '描边不透明度', unit: '%', min: 0, max: 80, step: 1 },
    blur: { label: 'CSS 模糊', unit: 'px', min: 0, max: 40, step: 1 },
    saturate: { label: '饱和度', unit: '%', min: 50, max: 200, step: 5 },
    radius: { label: '圆角半径', unit: 'px', min: 0, max: 24, step: 1 },
  };

  const meta = META[kind] || META.acrylic;
  const storageKey = (suffix) => `pkg-runner:lab:${kind}:${suffix}`;
  const root = document.documentElement;
  const values = { ...meta.defaults };

  function readNum(key, fallback, min, max) {
    try {
      const n = Number(localStorage.getItem(key));
      if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
    } catch {
      /* ignore */
    }
    return fallback;
  }

  function formatValue(id, v) {
    const u = KNOB_UI[id].unit;
    return u === '%' ? `${Math.round(v)}%` : `${Math.round(v)}${u}`;
  }

  function apply() {
    const shell = values.shell / 100;
    const panel = (values.panel ?? values.shell + 8) / 100;
    const border = (values.border ?? 28) / 100;
    const blur = values.blur ?? 0;
    const sat = (values.saturate ?? 100) / 100;
    const radius = values.radius ?? 10;

    root.style.setProperty('--alpha', String(shell));
    root.style.setProperty('--alpha-strong', String(Math.min(1, panel)));
    root.style.setProperty('--panel-alpha', String(Math.min(1, panel)));
    root.style.setProperty('--border-alpha', String(border));
    root.style.setProperty('--css-blur', `${blur}px`);
    root.style.setProperty('--saturate', String(sat));
    root.style.setProperty('--radius', `${radius}px`);
    root.style.setProperty('--clip', `inset(0 round ${radius}px)`);

    for (const id of meta.knobs) {
      const em = document.getElementById(`lab-${id}-label`);
      if (em) em.textContent = formatValue(id, values[id]);
    }

    document.getElementById('cardA').textContent = `外壳 α=${shell.toFixed(2)}`;
    document.getElementById('cardB').textContent = `面板 α=${Math.min(1, panel).toFixed(2)}`;
    document.getElementById('cardC').textContent = meta.knobs.includes('blur')
      ? `blur ${blur}px · sat ${Math.round(sat * 100)}%`
      : `描边 α=${border.toFixed(2)}`;
  }

  document.body.classList.add(meta.bodyClass);
  root.classList.add(meta.bodyClass);
  document.getElementById('title').textContent = meta.title;
  document.getElementById('tag').textContent = meta.tag;
  document.getElementById('desc').textContent = meta.desc;
  document.title = meta.title;

  const notes = document.getElementById('notes');
  for (const line of meta.notes) {
    const li = document.createElement('li');
    li.textContent = line;
    notes.appendChild(li);
  }

  const sliders = document.getElementById('sliders');
  for (const id of meta.knobs) {
    const conf = KNOB_UI[id];
    values[id] = readNum(storageKey(id), meta.defaults[id], conf.min, conf.max);

    const label = document.createElement('label');
    label.className = 'slider-row';
    label.innerHTML = `<span>${conf.label} <em id="lab-${id}-label"></em></span>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(conf.min);
    input.max = String(conf.max);
    input.step = String(conf.step);
    input.value = String(values[id]);
    input.addEventListener('input', () => {
      values[id] = Number(input.value);
      apply();
      try {
        localStorage.setItem(storageKey(id), String(values[id]));
      } catch {
        /* ignore */
      }
    });
    label.appendChild(input);
    sliders.appendChild(label);
  }

  apply();

  document.getElementById('closeBtn').addEventListener('click', () => {
    void window.pkgRunner.windowClose();
  });
})();
