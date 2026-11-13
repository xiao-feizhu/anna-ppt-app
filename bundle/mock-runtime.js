/**
 * mock-runtime.js — 本地静态预览用的模拟 Anna 运行时。
 * 仅在无法连接 Anna 宿主 SDK 时启用（例如直接用静态服务器打开 bundle/）。
 * 不消耗任何额度，返回演示数据，用于验证 UI 与导出流程。
 * 正式开发请使用 anna-app dev（--llm mock 或 real）。
 */

const STORE_KEY = 'ppt-studio.mock.storage';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}
function writeStore(map) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch { /* 隐私模式下忽略 */ }
}

const PAGE_POOL = [
  ['背景与问题', ['为什么要讨论这个话题', '当前面临的核心痛点', '不解决会带来什么影响']],
  ['目标与受众', ['本次分享希望达成的目标', '目标受众是谁、关心什么', '衡量成功的关键标准']],
  ['现状分析', ['行业或领域的整体趋势', '现有做法的局限性', '值得借鉴的实践经验']],
  ['核心思路', ['解决问题的总体框架', '三个关键切入点', '与常见方案的差异']],
  ['方案设计（上）', ['方案的整体结构', '核心模块如何协作', '关键设计取舍']],
  ['方案设计（下）', ['落地所需的资源', '与现有流程的衔接', '可复用的工具与方法']],
  ['实施计划', ['分阶段的推进节奏', '里程碑与负责人', '需要的支持与配合']],
  ['风险与应对', ['主要不确定性因素', '预案与兜底措施', '需要持续观察的信号']],
  ['总结与展望', ['核心观点回顾', '下一步行动建议', '长期价值与想象空间']],
];

function extractTopic(text) {
  const m = text.match(/主题：([^\n]+)/);
  return m ? m[1].trim() : '演示主题';
}
function extractPages(text) {
  const m = text.match(/内容页数：(\d+)\s*页/);
  return m ? Math.min(Math.max(parseInt(m[1], 10) || 8, 1), 12) : 8;
}

function mockOutline(text) {
  const topic = extractTopic(text);
  const pages = extractPages(text);
  const slides = Array.from({ length: pages }, (_, i) => {
    const [title, points] = PAGE_POOL[i % PAGE_POOL.length];
    return { title, points: points.map((p) => `${p}（演示数据）`) };
  });
  return { title: `${topic}：演示文稿`, slides };
}

function mockDeck(text) {
  const topic = extractTopic(text);
  const outlineMatch = text.match(/共\s*(\d+)\s*页/);
  const pages = outlineMatch ? parseInt(outlineMatch[1], 10) : extractPages(text);
  const slides = Array.from({ length: pages }, (_, i) => {
    const [title] = PAGE_POOL[i % PAGE_POOL.length];
    return {
      title,
      bullets: [
        `围绕「${topic}」，本页要点一：给出具体事实与背景信息（演示数据）`,
        '要点二：补充关键数据或案例，让论述更有说服力（演示数据）',
        '要点三：说明对受众的实际意义与可执行的建议（演示数据）',
      ],
      notes: `这是第 ${i + 1} 页的演讲备注（演示数据）。正式环境中，这里会是由 AI 撰写的 80-150 字口语化讲稿，帮助演讲者组织语言、控制节奏。`,
    };
  });
  return { title: `${topic}：演示文稿`, slides };
}

function mockSlide(text) {
  const topic = extractTopic(text);
  const idx = text.match(/第\s*(\d+)\s*页/);
  const no = idx ? idx[1] : '1';
  return {
    title: `第 ${no} 页（重新生成·演示数据）`,
    bullets: [
      `重新生成的要点一，聚焦「${topic}」（演示数据）`,
      '重新生成的要点二，换一种表述角度（演示数据）',
      '重新生成的要点三，补充新的论据（演示数据）',
    ],
    notes: '这是重新生成后的演讲备注（演示数据）。',
  };
}

export function createMockRuntime() {
  const store = readStore();
  return {
    isMock: true,
    runtimeState: store,
    entryPayload: null,
    on: () => () => {},
    window: { set_title: async () => {} },
    storage: {
      async set({ key, value }) {
        const map = readStore();
        map[key] = value;
        writeStore(map);
        return { ok: true };
      },
      async get({ key }) {
        return { value: readStore()[key] };
      },
      async delete({ key }) {
        const map = readStore();
        delete map[key];
        writeStore(map);
        return { ok: true };
      },
    },
    llm: {
      async complete({ messages }) {
        await sleep(700);
        const text = messages.map((m) => m.content?.text || '').join('\n');
        let data;
        if (text.includes('[STAGE:deck]')) data = mockDeck(text);
        else if (text.includes('[STAGE:slide]')) data = mockSlide(text);
        else data = mockOutline(text);
        const output = JSON.stringify(data, null, 2);
        return {
          role: 'assistant',
          content: { type: 'text', text: output },
          stopReason: 'endTurn',
          usage: {
            inputTokens: Math.ceil(text.length / 2),
            outputTokens: Math.ceil(output.length / 2),
            totalTokens: Math.ceil((text.length + output.length) / 2),
          },
          _meta: { quotaConsumed: 0 },
        };
      },
    },
  };
}
