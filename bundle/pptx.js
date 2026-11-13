/**
 * pptx.js — 幻灯片版式定义与 .pptx 导出（PptxGenJS，纯浏览器端）。
 * 预览与导出共用 THEMES 与同一份 deck 数据，保证所见即所得。
 */

export const THEMES = {
  business: {
    label: '商务藏青', dot: '#1e3a5f',
    bg: '#ffffff', ink: '#1c2430', accent: '#1e3a5f',
    coverBg: '#1e3a5f', coverInk: '#ffffff', muted: '#6b7280',
  },
  academic: {
    label: '学术墨绿', dot: '#14532d',
    bg: '#fbfdfc', ink: '#1a2e22', accent: '#14532d',
    coverBg: '#14532d', coverInk: '#ffffff', muted: '#6b7280',
  },
  vivid: {
    label: '活力暖橙', dot: '#c2410c',
    bg: '#fffdfb', ink: '#292018', accent: '#c2410c',
    coverBg: '#c2410c', coverInk: '#ffffff', muted: '#78716c',
  },
};

const FONT = 'Microsoft YaHei';

function bulletFontSize(slide) {
  const chars = slide.bullets.join('').length;
  if (chars > 260 || slide.bullets.length > 5) return 16;
  if (chars > 170) return 18;
  return 20;
}

/**
 * 用 deck 数据构建 PptxGenJS 演示文稿（封面 + 内容页 + 结尾页）。
 * 浏览器与 Node 测试共用：由调用方传入 PptxGenJS 构造函数。
 */
export function buildPresentation(PptxGenJS, deck, themeKey, meta = {}) {
  const theme = THEMES[themeKey] || THEMES.business;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.title = deck.title;

  // 封面
  const cover = pptx.addSlide();
  cover.background = { color: theme.coverBg };
  cover.addText(deck.title, {
    x: 0.9, y: 2.3, w: 11.5, h: 1.8, fontFace: FONT,
    fontSize: deck.title.length > 24 ? 30 : 38, bold: true, color: theme.coverInk,
  });
  cover.addText(meta.subtitle || '由 PPT 工坊生成', {
    x: 0.9, y: 4.4, w: 11.5, h: 0.6, fontFace: FONT, fontSize: 16, color: theme.coverInk,
  });
  cover.addShape('rect', { x: 0.9, y: 4.1, w: 1.2, h: 0.06, fill: { color: theme.coverInk } });

  // 内容页
  deck.slides.forEach((slide, i) => {
    const s = pptx.addSlide();
    s.background = { color: theme.bg };
    s.addText(slide.title, {
      x: 0.6, y: 0.35, w: 12.1, h: 0.8, fontFace: FONT,
      fontSize: 26, bold: true, color: theme.ink,
    });
    s.addShape('rect', { x: 0.65, y: 1.22, w: 0.9, h: 0.055, fill: { color: theme.accent } });

    const runs = slide.bullets.map((b) => ({
      text: b,
      options: { bullet: { code: '2022' }, paraSpaceAfter: 10, breakLine: true },
    }));
    if (runs.length) {
      s.addText(runs, {
        x: 0.7, y: 1.55, w: 11.9, h: 4.9, fontFace: FONT,
        fontSize: bulletFontSize(slide), color: theme.ink, valign: 'top', lineSpacingMultiple: 1.25,
      });
    }
    s.addText(deck.title, {
      x: 0.6, y: 7.05, w: 9, h: 0.35, fontFace: FONT, fontSize: 9, color: theme.muted,
    });
    s.addText(`${i + 1} / ${deck.slides.length}`, {
      x: 11.6, y: 7.05, w: 1.1, h: 0.35, fontFace: FONT, fontSize: 9, color: theme.muted, align: 'right',
    });
    if (slide.notes) s.addNotes(slide.notes);
  });

  // 结尾页
  const end = pptx.addSlide();
  end.background = { color: theme.coverBg };
  end.addText('谢谢聆听', {
    x: 0.9, y: 2.7, w: 11.5, h: 1.2, fontFace: FONT, fontSize: 40, bold: true, color: theme.coverInk, align: 'center',
  });
  end.addText('欢迎交流 · Q&A', {
    x: 0.9, y: 4.1, w: 11.5, h: 0.7, fontFace: FONT, fontSize: 18, color: theme.coverInk, align: 'center',
  });

  return pptx;
}

/** 浏览器端导出：生成并下载 .pptx 文件。 */
export async function exportDeck(deck, themeKey) {
  if (typeof window === 'undefined' || !window.PptxGenJS) {
    throw new Error('PptxGenJS 未加载，请检查 vendor/pptxgen.bundle.js');
  }
  const date = new Date().toISOString().slice(0, 10);
  const pptx = buildPresentation(window.PptxGenJS, deck, themeKey, {
    subtitle: `由 PPT 工坊生成 · ${date}`,
  });
  const safeName = deck.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '演示文稿';
  await pptx.writeFile({ fileName: `${safeName}.pptx` });
}
