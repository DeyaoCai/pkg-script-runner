(() => {
  const ITEMS = [
    {
      kind: 'acrylic',
      title: 'Acrylic + OS 圆角',
      meta: '滑块：外壳 / 面板 / 描边 · 系统模糊不可调',
    },
    {
      kind: 'mica',
      title: 'Mica + OS 圆角',
      meta: '滑块：外壳 / 面板 / 描边 · 系统模糊不可调',
    },
    {
      kind: 'tabbed',
      title: 'Tabbed + OS 圆角',
      meta: '滑块：外壳 / 面板 / 描边',
    },
    {
      kind: 'acrylic-clip',
      title: 'Acrylic + CSS clip 圆角',
      meta: '滑块：外壳 / 面板 / 描边 / 圆角半径',
    },
    {
      kind: 'css-only',
      title: '纯 CSS（对照）',
      meta: '滑块：外壳 / CSS模糊 / 饱和度 / 圆角 · 桌面模糊通常无效',
    },
  ];

  const list = document.getElementById('list');
  for (const item of ITEMS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item';
    btn.innerHTML = `<span class="item-title">${item.title}</span><span class="item-go">打开</span><span class="item-meta">${item.meta}</span>`;
    btn.addEventListener('click', () => {
      void window.pkgRunner.openGlassLab(item.kind);
    });
    list.appendChild(btn);
  }

  document.getElementById('closeBtn').addEventListener('click', () => {
    void window.pkgRunner.windowClose();
  });
})();
