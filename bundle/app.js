/**
 * app.js — PPT 工坊主逻辑。
 * 三阶段流程：输入主题 → 确认大纲 → 生成正文 / 编辑 / 导出。
 * 优先连接 Anna 宿主 SDK；连接失败时进入本地预览模式（mock，不耗额度）。
 */
import {
  outlineRequest, deckRequest, slideRequest,
  completeJson, normalizeOutline, normalizeDeck, normalizeSlide,
} from './llm.js';
import { THEMES, exportDeck } from './pptx.js';
import { createMockRuntime } from './mock-runtime.js';

const STEPS = [
  { key: 'input', label: '1 主题与要求' },
  { key: 'outline', label: '2 确认大纲' },
  { key: 'slides', label: '3 正文与导出' },
];
const TONES = ['专业简洁', '学术严谨', '轻松通俗', '激昂动员'];

const state = {
  step: 'input',
  input: { topic: '', pages: 8, audience: '', tone: TONES[0], material: '', theme: 'business' },
  outline: null,
  deck: null,
  current: 0,
  usage: { calls: 0, tokens: 0, quota: 0 },
  busy: false,
};
let anna;

/* ---------------- 工具 ---------------- */
const $ = (sel) => document.querySelector(sel);
const view = () => $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3000);
}

function setBusy(flag, text = '正在调用 AI…') {
  state.busy = flag;
  $('#loading').hidden = !flag;
  $('#loading-text').textContent = text;
  view().querySelectorAll('button, input, textarea, select').forEach((el) => {
    el.disabled = flag;
  });
}

function onUsage(usage, meta) {
  state.usage.calls += 1;
  state.usage.tokens += usage?.totalTokens || 0;
  state.usage.quota += meta?.quotaConsumed || 0;
  const { calls, tokens, quota } = state.usage;
  $('#usage').textContent = `AI 调用 ${calls} 次 · ${tokens.toLocaleString()} tokens`
    + (quota > 0 ? ` · 额度 ${quota}` : '');
}

let saveTimer;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await anna.storage.set({
        key: 'draft',
        value: {
          step: state.step, input: state.input,
          outline: state.outline, deck: state.deck, current: state.current,
        },
      });
    } catch { /* 草稿保存失败不打扰用户 */ }
  }, 800);
}

/* ---------------- 初始化 ---------------- */
async function init() {
  try {
    const { AnnaAppRuntime } = await import('/static/anna-apps/_sdk/latest/index.js');
    anna = await AnnaAppRuntime.connect();
  } catch {
    anna = createMockRuntime();
    $('#env-badge').hidden = false;
  }

  const draft = anna.runtimeState?.draft;
  if (draft?.input) {
    state.input = { ...state.input, ...draft.input };
    state.outline = draft.outline || null;
    state.deck = draft.deck || null;
    state.current = draft.current || 0;
    state.step = state.deck ? 'slides' : state.outline ? 'outline' : 'input';
  }
  const topic = anna.entryPayload?.topic;
  if (topic && !state.input.topic) state.input.topic = String(topic);

  anna.window?.set_title?.({ title: 'PPT 工坊' });
  $('#btn-reset').addEventListener('click', onReset);
  render();
}

/* ---------------- 步骤条与路由 ---------------- */
function maxStepIndex() {
  if (state.deck) return 2;
  if (state.outline) return 1;
  return 0;
}

function renderSteps() {
  const cur = STEPS.findIndex((s) => s.key === state.step);
  const max = maxStepIndex();
  $('#steps').innerHTML = STEPS.map((s, i) => {
    const cls = i === cur ? 'active' : i < max ? 'reachable' : '';
    return `<li class="${cls}" data-step="${s.key}" ${i < max && i !== cur ? 'tabindex="0" role="button"' : ''}>${s.label}</li>`;
  }).join('');
  $('#steps').querySelectorAll('li.reachable').forEach((li) => {
    const go = () => { state.step = li.dataset.step; render(); };
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

function render() {
  renderSteps();
  if (state.step === 'outline' && state.outline) renderOutline();
  else if (state.step === 'slides' && state.deck) renderDeck();
  else renderInput();
  saveDraft();
}

/* ---------------- 阶段一：输入 ---------------- */
function renderInput() {
  const { input } = state;
  view().innerHTML = `
    <section class="panel panel-narrow">
      <h1>用 AI 做一份能直接修改的 PPT</h1>
      <p class="sub">先生成大纲，你确认后再写正文，最后导出 .pptx——每一步都由你掌控。</p>
      <form id="input-form">
        <div class="field">
          <label for="f-topic">演示主题</label>
          <input id="f-topic" type="text" required maxlength="120" placeholder="例如：面向大一新生的人工智能入门"
            value="${esc(input.topic)}" data-input="topic" />
        </div>
        <div class="field-grid">
          <div class="field">
            <label for="f-pages">内容页数<span class="hint">4-12，不含封面结尾</span></label>
            <input id="f-pages" type="number" min="4" max="12" value="${input.pages}" data-input="pages" />
          </div>
          <div class="field">
            <label for="f-audience">目标受众<span class="hint">可选</span></label>
            <input id="f-audience" type="text" maxlength="60" placeholder="例如：公司管理层"
              value="${esc(input.audience)}" data-input="audience" />
          </div>
          <div class="field">
            <label for="f-tone">语言风格</label>
            <select id="f-tone" data-input="tone">
              ${TONES.map((t) => `<option ${t === input.tone ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="f-material">补充资料<span class="hint">可选，AI 优先依据，截取前 3000 字</span></label>
          <textarea id="f-material" rows="4" placeholder="粘贴报告、笔记、会议纪要等"
            data-input="material">${esc(input.material)}</textarea>
        </div>
        <div class="field">
          <label>版式配色</label>
          <div class="theme-picker">
            ${Object.entries(THEMES).map(([key, t]) => `
              <label class="theme-option">
                <input type="radio" name="theme" value="${key}" ${key === input.theme ? 'checked' : ''} data-input="theme" />
                <span class="theme-dot" style="background:${t.dot}"></span>${t.label}
              </label>`).join('')}
          </div>
        </div>
        <div class="tip-box">大纲与正文各调用 1 次 AI；顶栏会实时显示 token 用量。建议先用少量页数试跑，满意后再加大页数。</div>
        <div class="btn-row">
          <button class="btn btn-primary" type="submit">生成大纲（1 次 AI 调用）</button>
        </div>
      </form>
    </section>`;

  $('#input-form').addEventListener('submit', (e) => { e.preventDefault(); onGenerateOutline(); });
  $('#input-form').addEventListener('input', (e) => {
    const key = e.target.dataset.input;
    if (!key) return;
    state.input[key] = key === 'pages'
      ? Math.min(Math.max(parseInt(e.target.value, 10) || 8, 4), 12)
      : e.target.value;
    saveDraft();
  });
}

/* ---------------- 阶段二：大纲 ---------------- */
function renderOutline() {
  const { outline } = state;
  view().innerHTML = `
    <section class="panel panel-narrow">
      <h1>确认大纲 <span class="hint" style="font-size:14px;font-weight:400">共 ${outline.slides.length} 页，导出时自动加封面与结尾页</span></h1>
      <p class="sub">总标题：${esc(outline.title)}（生成正文后仍可逐页修改）</p>
      <div class="tip-box">这一步不消耗额度。请把大纲改到满意为止——确认结构后再生成正文，避免整份返工。</div>
      <div id="outline-list">
        ${outline.slides.map((s, i) => `
          <div class="outline-item" data-i="${i}">
            <div class="outline-head">
              <span class="outline-no">第 ${i + 1} 页</span>
              <input class="outline-title-input" type="text" value="${esc(s.title)}"
                data-i="${i}" data-field="title" aria-label="第 ${i + 1} 页标题" />
              <div class="outline-ops">
                <button class="icon-btn" data-action="up" data-i="${i}" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="icon-btn" data-action="down" data-i="${i}" title="下移" ${i === outline.slides.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="icon-btn btn-danger" data-action="del" data-i="${i}" title="删除本页" ${outline.slides.length <= 1 ? 'disabled' : ''}>✕</button>
              </div>
            </div>
            <textarea class="outline-points" rows="2" data-i="${i}" data-field="points"
              aria-label="第 ${i + 1} 页要点，每行一条">${esc(s.points.join('\n'))}</textarea>
          </div>`).join('')}
      </div>
      <button id="btn-add-page" class="btn btn-small" type="button">＋ 添加一页</button>
      <div class="footer-bar">
        <button id="btn-back-input" class="btn" type="button">← 返回修改主题</button>
        <div class="btn-row">
          <span class="cost-note">下一步仅 1 次 AI 调用，生成全部 ${outline.slides.length} 页正文与演讲备注</span>
          <button id="btn-gen-deck" class="btn btn-primary" type="button">生成 PPT 正文 →</button>
        </div>
      </div>
    </section>`;

  $('#btn-back-input').addEventListener('click', () => { state.step = 'input'; render(); });
  $('#btn-gen-deck').addEventListener('click', onGenerateDeck);
  $('#btn-add-page').addEventListener('click', () => {
    state.outline.slides.push({ title: '新的一页', points: [] });
    render();
  });
  $('#outline-list').addEventListener('input', (e) => {
    const { i, field } = e.target.dataset;
    if (field === undefined) return;
    const slide = state.outline.slides[Number(i)];
    if (field === 'title') slide.title = e.target.value;
    if (field === 'points') slide.points = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
    saveDraft();
  });
  $('#outline-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    const slides = state.outline.slides;
    const action = btn.dataset.action;
    if (action === 'del') slides.splice(i, 1);
    if (action === 'up' && i > 0) [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]];
    if (action === 'down' && i < slides.length - 1) [slides[i + 1], slides[i]] = [slides[i], slides[i + 1]];
    render();
  });
}

/* ---------------- 阶段三：正文与导出 ---------------- */
function slideCanvasHTML(slide, index) {
  const t = THEMES[state.input.theme] || THEMES.business;
  const { deck } = state;
  return `
    <div class="slide-canvas" style="--s-bg:${t.bg};--s-ink:${t.ink};--s-accent:${t.accent}">
      <div class="slide-kicker">${esc(deck.title)}</div>
      <h2 class="slide-title">${esc(slide.title)}</h2>
      <ul class="slide-bullets">
        ${slide.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}
      </ul>
      <div class="slide-footer"><span>PPT 工坊</span><span>${index + 1} / ${deck.slides.length}</span></div>
    </div>`;
}

function renderDeck() {
  const { deck, current } = state;
  view().innerHTML = `
    <div class="deck-layout">
      <aside>
        <div class="tip-box" style="margin-top:0">导出文件自动包含封面与结尾页；备注写入演讲者备注。</div>
        <div class="thumb-list" id="thumb-list">
          ${deck.slides.map((s, i) => `
            <button class="thumb ${i === current ? 'current' : ''}" data-i="${i}" type="button">
              <div class="thumb-no">第 ${i + 1} 页</div>
              <div class="thumb-title" id="thumb-title-${i}">${esc(s.title)}</div>
            </button>`).join('')}
        </div>
      </aside>
      <section class="slide-stage">
        <div id="slide-preview">${slideCanvasHTML(deck.slides[current], current)}</div>
        <div class="slide-editor">
          <div class="editor-head">
            <h2>编辑第 ${current + 1} 页</h2>
            <button id="btn-regen" class="btn btn-small" type="button" title="用 AI 重写本页（1 次调用）">↻ 重新生成此页</button>
          </div>
          <div class="field">
            <label for="e-title">页标题</label>
            <input id="e-title" type="text" value="${esc(deck.slides[current].title)}" data-field="title" />
          </div>
          <div class="field">
            <label for="e-bullets">要点<span class="hint">每行一条，建议 3-5 条</span></label>
            <textarea id="e-bullets" rows="4" data-field="bullets">${esc(deck.slides[current].bullets.join('\n'))}</textarea>
          </div>
          <div class="field">
            <label for="e-notes">演讲备注<span class="hint">导出后写入 pptx 备注</span></label>
            <textarea id="e-notes" rows="2" data-field="notes">${esc(deck.slides[current].notes)}</textarea>
          </div>
        </div>
        <div class="footer-bar">
          <button id="btn-back-outline" class="btn" type="button">← 返回大纲</button>
          <div class="btn-row">
            <span class="cost-note">共 ${deck.slides.length + 2} 页（含封面结尾）</span>
            <button id="btn-export" class="btn btn-primary" type="button">导出 .pptx</button>
          </div>
        </div>
      </section>
    </div>`;

  $('#thumb-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.thumb');
    if (!btn) return;
    state.current = Number(btn.dataset.i);
    renderDeck();
    saveDraft();
  });
  $('#btn-back-outline').addEventListener('click', () => { state.step = 'outline'; render(); });
  $('#btn-export').addEventListener('click', onExport);
  $('#btn-regen').addEventListener('click', onRegenSlide);

  $('.slide-editor').addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const slide = state.deck.slides[state.current];
    if (field === 'title') slide.title = e.target.value;
    if (field === 'bullets') slide.bullets = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (field === 'notes') slide.notes = e.target.value;
    // 局部刷新预览与缩略图，不重渲染编辑器（避免输入失焦）
    $('#slide-preview').innerHTML = slideCanvasHTML(slide, state.current);
    const thumb = $(`#thumb-title-${state.current}`);
    if (thumb) thumb.textContent = slide.title;
    saveDraft();
  });
}

/* ---------------- AI 生成动作 ---------------- */
async function onGenerateOutline() {
  if (!state.input.topic.trim()) { toast('请先填写演示主题', true); return; }
  setBusy(true, '正在生成大纲…');
  try {
    state.outline = await completeJson(
      anna, outlineRequest(state.input),
      (data) => normalizeOutline(data, state.input),
      { onUsage },
    );
    state.deck = null;
    state.step = 'outline';
    render();
  } catch (err) {
    toast(err.message || '大纲生成失败，请重试', true);
  } finally {
    setBusy(false);
  }
}

async function onGenerateDeck() {
  setBusy(true, `正在撰写全部 ${state.outline.slides.length} 页正文与演讲备注…`);
  try {
    state.deck = await completeJson(
      anna, deckRequest(state.input, state.outline),
      (data) => normalizeDeck(data, state.outline),
      { onUsage },
    );
    state.current = 0;
    state.step = 'slides';
    render();
    toast('正文生成完成，可逐页修改或导出');
  } catch (err) {
    toast(err.message || '正文生成失败，大纲已保留，可重试', true);
  } finally {
    setBusy(false);
  }
}

async function onRegenSlide() {
  const index = state.current;
  setBusy(true, `正在重新生成第 ${index + 1} 页…`);
  try {
    const fallback = state.deck.slides[index];
    state.deck.slides[index] = await completeJson(
      anna, slideRequest(state.input, state.outline, index),
      (data) => normalizeSlide(data, fallback),
      { onUsage },
    );
    renderDeck();
    saveDraft();
    toast(`第 ${index + 1} 页已重新生成`);
  } catch (err) {
    toast(err.message || '重新生成失败，请重试', true);
  } finally {
    setBusy(false);
  }
}

/* ---------------- 导出与重置 ---------------- */
async function onExport() {
  const btn = $('#btn-export');
  btn.disabled = true;
  btn.textContent = '正在生成文件…';
  try {
    await exportDeck(state.deck, state.input.theme);
    toast('已导出 .pptx，可在 PowerPoint / WPS 中继续编辑');
  } catch (err) {
    toast(err.message || '导出失败，请重试', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出 .pptx';
  }
}

async function onReset() {
  if ((state.outline || state.deck) && !window.confirm('新建将清空当前大纲与正文（草稿也会删除），确定吗？')) return;
  state.outline = null;
  state.deck = null;
  state.current = 0;
  state.step = 'input';
  try { await anna.storage.delete({ key: 'draft' }); } catch { /* 忽略 */ }
  render();
}

init().catch((err) => {
  view().innerHTML = `<section class="panel panel-narrow"><h1>初始化失败</h1><p class="sub">${esc(err.message)}</p></section>`;
});
