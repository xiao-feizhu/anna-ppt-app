/**
 * llm.js — AI 调用层：prompt 设计、JSON 解析与结构校验、额度统计。
 * 只依赖 anna.llm.complete（SDK ≥ 0.17 时 maxTokens > 8192 自动走流式通道，
 * 因此整份正文生成不受同步 8192 上限影响）。
 */

/** 从模型输出中提取 JSON 对象（容忍 ```json 围栏与首尾杂文本）。 */
export function extractJson(text) {
  if (!text || typeof text !== 'string') throw new Error('模型返回为空');
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('模型未返回 JSON 内容');
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new Error('JSON 解析失败，可能是输出被截断');
  }
}

const asStr = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const asStrList = (v, max) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, max);

/** 校验并规范化大纲；页数以用户选择为准做截断。 */
export function normalizeOutline(data, input) {
  const title = asStr(data.title, input.topic);
  let slides = (Array.isArray(data.slides) ? data.slides : [])
    .map((s) => ({
      title: asStr(s?.title),
      points: asStrList(s?.points, 6),
    }))
    .filter((s) => s.title);
  if (!slides.length) throw new Error('大纲内容为空');
  slides = slides.slice(0, input.pages);
  return { title, slides };
}

/** 校验并规范化正文；与大纲逐页对齐，缺页用大纲要点兜底，保证页数一致。 */
export function normalizeDeck(data, outline) {
  const generated = Array.isArray(data.slides) ? data.slides : [];
  const slides = outline.slides.map((o, i) => {
    const g = generated[i] || {};
    const bullets = asStrList(g.bullets, 6);
    return {
      title: asStr(g.title, o.title),
      bullets: bullets.length ? bullets : o.points.slice(0, 5),
      notes: asStr(g.notes),
    };
  });
  return { title: asStr(data.title, outline.title), slides };
}

/** 校验并规范化单页（用于单页重新生成）。 */
export function normalizeSlide(data, fallback) {
  const bullets = asStrList(data.bullets, 6);
  if (!asStr(data.title) && !bullets.length) throw new Error('单页内容为空');
  return {
    title: asStr(data.title, fallback.title),
    bullets: bullets.length ? bullets : fallback.bullets,
    notes: asStr(data.notes, fallback.notes || ''),
  };
}

/* ---------------- Prompt ---------------- */

function inputDigest(input) {
  return [
    `主题：${input.topic}`,
    `内容页数：${input.pages} 页（不含封面与结尾页）`,
    input.audience && `目标受众：${input.audience}`,
    `语言风格：${input.tone}`,
    input.material && `补充资料（优先依据）：\n${input.material.slice(0, 3000)}`,
  ].filter(Boolean).join('\n');
}

export function outlineRequest(input) {
  return {
    maxTokens: 3000,
    messages: [
      {
        role: 'system',
        content: { type: 'text', text:
          '你是专业的演示文稿策划师。只输出一个 JSON 对象，不要输出任何其他文字、解释或代码围栏。' +
          'JSON 结构：{"title": "演示文稿总标题", "slides": [{"title": "页标题", "points": ["要点1", "要点2", "要点3"]}]}。' +
          '要求：slides 数量严格等于用户指定的内容页数；每页 2-4 个要点，每个要点不超过 25 字；' +
          '页面顺序符合叙事逻辑（背景→分析→方案→总结等）；使用简体中文。' },
      },
      { role: 'user', content: { type: 'text', text: `[STAGE:outline]\n请为以下演示需求设计大纲：\n${inputDigest(input)}` } },
    ],
  };
}

export function deckRequest(input, outline) {
  const outlineText = outline.slides
    .map((s, i) => `第${i + 1}页「${s.title}」：${s.points.join('；')}`)
    .join('\n');
  return {
    maxTokens: 12000,
    messages: [
      {
        role: 'system',
        content: { type: 'text', text:
          '你是专业的演示文稿撰稿人。只输出一个 JSON 对象，不要输出任何其他文字、解释或代码围栏。' +
          'JSON 结构：{"title": "演示文稿总标题", "slides": [{"title": "页标题", "bullets": ["要点1", "要点2"], "notes": "演讲备注"}]}。' +
          '要求：slides 数量与顺序严格对齐用户给出的大纲；每页 3-5 条要点，每条 15-40 字，具体、有信息量，不写空话；' +
          'notes 为该页的口语化演讲备注，80-150 字，用于演讲者参考；使用简体中文。' },
      },
      {
        role: 'user',
        content: { type: 'text', text:
          `[STAGE:deck]\n演示需求：\n${inputDigest(input)}\n\n已确认的大纲（总标题「${outline.title}」，共 ${outline.slides.length} 页）：\n${outlineText}\n\n请撰写全部 ${outline.slides.length} 页的正文要点与演讲备注。` },
      },
    ],
  };
}

export function slideRequest(input, outline, index) {
  const o = outline.slides[index];
  return {
    maxTokens: 1500,
    messages: [
      {
        role: 'system',
        content: { type: 'text', text:
          '你是专业的演示文稿撰稿人。只输出一个 JSON 对象：{"title": "页标题", "bullets": ["要点1", "要点2"], "notes": "演讲备注"}。' +
          '不要输出任何其他文字或代码围栏。每页 3-5 条要点，每条 15-40 字；notes 为 80-150 字口语化演讲备注；使用简体中文。' },
      },
      {
        role: 'user',
        content: { type: 'text', text:
          `[STAGE:slide]\n演示主题：${input.topic}（整体标题「${outline.title}」）。\n请重新撰写第 ${index + 1} 页，页标题方向：「${o.title}」，需覆盖：${o.points.join('；') || '自由发挥'}。` },
      },
    ],
  };
}

/* ---------------- 调用封装 ---------------- */

/**
 * 调用 anna.llm.complete 并解析 JSON。
 * - 兼容 { ok, result } 包装与直接返回两种形态；错误抛带友好文案的 Error。
 * - JSON 解析/校验失败自动重试 1 次（每次调用都会计入用量）。
 */
export async function completeJson(anna, request, normalize, { retries = 1, onUsage } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let payload;
    try {
      payload = await callComplete(anna, request);
    } catch (err) {
      // 调用本身失败（网络/额度/权限）：重试无意义且可能重复计费，直接抛出
      throw friendlyError(err);
    }
    if (onUsage) onUsage(payload.usage, payload._meta);
    try {
      const text = payload?.content?.text ?? '';
      return normalize(extractJson(text));
    } catch (err) {
      lastError = err;
      if (payload?.stopReason === 'maxTokens') {
        lastError = new Error('输出达到长度上限被截断，建议减少页数或精简资料后重试');
      }
    }
  }
  throw lastError;
}

async function callComplete(anna, request) {
  const res = await anna.llm.complete(request);
  if (res && res.ok === false) {
    const e = new Error(res.error?.message || 'AI 调用失败');
    e.code = res.error?.code;
    throw e;
  }
  return res && res.ok === true ? res.result : res;
}

function friendlyError(err) {
  const code = err?.code || err?.name || '';
  if (code === 'quota_exceeded') return new Error('额度不足或已达当日上限，请检查账户额度');
  if (code === 'not_implemented') return new Error('当前环境未启用 LLM，请用 anna-app dev --llm real 或在平台内运行');
  if (code === 'APP_SESSION_EXPIRED' || code === 'invalid_token') return new Error('会话已过期，请重新打开 App');
  return err instanceof Error ? err : new Error(String(err));
}
