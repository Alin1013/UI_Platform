/**
 * 自然语言测试用例解析器。
 * 采用确定性规则而不是直接调用大模型，保证同一句法生成同一套 Playwright 步骤。
 */

import type { AutomationStep } from "./types";

export interface NaturalLanguageResult {
  steps: AutomationStep[];
  /** 保留行号和原文，让界面能精确指出哪一句无法编译。 */
  errors: string[];
}

/** 兼容中文引号、英文引号和反引号；URL 与期望文本通常由这些符号包裹。 */
function quotedValue(text: string): string | undefined {
  const match = text.match(/["'`“”‘’]([^"'`“”‘’]+)["'`“”‘’]/);
  return match?.[1]?.trim();
}

function withoutQuotes(text: string): string {
  const quoted = quotedValue(text);
  return (quoted ?? text).trim();
}

/** 将自然语言里的可见文本转成 Playwright 文本定位器；CSS 选择器则原样保留。 */
function targetFromText(text: string): string {
  const value = withoutQuotes(text);
  return /^(\/|\.|#|\[|text=|input|button|a\b|main|form|label)/i.test(value)
    ? value
    : `text=${value}`;
}

/** 常见表单字段翻译为语义定位器，执行器再按 label、placeholder 或 aria-label 兜底查找。 */
const compactFieldLabels = [
  "账号",
  "用户名",
  "用户",
  "邮箱",
  "手机号",
  "手机",
  "租户",
  "组织",
  "公司",
  "工号",
  "姓名",
  "密码",
  "验证码",
] as const;

/** 解析单个 URL；中文句号可能出现在 URL 中，因此不能按普通标点切分。 */
function urlFromText(text: string): string {
  const quoted = quotedValue(text);
  if (quoted) return quoted;
  return (
    text.match(/(?:https?:\/\/|\/)[^\s，,。；;]+/)?.[0] ??
    text.split(/\s+/).find((token) => token && !/^(打开|访问|导航|goto|open|to)$/i.test(token)) ??
    "/"
  );
}

function parseLine(line: string): AutomationStep | undefined {
  const text = line.trim().replace(/^(\d+[.、)|]\s*)/, "");
  if (!text || /^(#|\/\/)/.test(text)) return undefined;
  const lower = text.toLowerCase();

  // 中文不是 JavaScript 正则里的 word character，动词后不能使用 \b 判断边界。
  if (/^(打开|访问|导航到|goto|open)/.test(text) || /^导航\s*到/.test(text)) {
    return { action: "goto", value: urlFromText(text.replace(/^(打开|访问|导航到|goto|open)\s*/i, "")) };
  }

  if (/^(等待|sleep|wait)/.test(text)) {
    const milliseconds = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:毫秒|ms|秒|s)?/i)?.[1] ?? 1000);
    const unit = /(?:秒|s)\s*$/i.test(text) && !/ms\s*$/i.test(text) ? 1000 : 1;
    return { action: "wait", timeout: Math.max(100, Math.round(milliseconds * unit)) };
  }

  if (/^(按下|按键|按|press)/.test(text)) {
    const key = quotedValue(text) ?? text.replace(/^(按下|按键|按|press)\s*(?:键)?\s*/i, "");
    if (!key) throw new Error("缺少按键名称");
    return { action: "press", value: key };
  }

  if (/^(断言|验证|expect)/.test(text) || /(?:断言|验证|expect)\s+(?:页面|文本)/.test(text)) {
    const expectation = quotedValue(text) ?? text.replace(/^(断言|验证|expect)\s*(?:页面|文本)?\s*(?:包含|contains?)?\s*/i, "");
    if (!expectation) throw new Error("缺少期望文本");
    return { action: "expectText", value: expectation };
  }

  // 中文常写成“账号输入xxx”，没有“在”和空格；先按已知字段名提取，避免误判成定位器。
  const compactFillMatch = text.match(
    new RegExp(
      `^(${compactFieldLabels.join("|")})\\s*(?:请)?(?:输入|填写|填入)\\s*(.+)$`,
    ),
  );
  if (compactFillMatch) {
    return {
      action: "fill",
      target: `label=${compactFillMatch[1]}`,
      value: withoutQuotes(compactFillMatch[2]),
    };
  }

  // 输入语句优先识别“在 target 输入 value”；target 可以是 CSS 选择器或可见文本。
  const fillMatch = text.match(
    /^(?:在\s+)?(.+?)\s*(?:中\s*)?(?:输入|填写|填入|type|fill)\s+(?:值\s*)?(.+)$/i,
  );
  if (fillMatch) {
    const rawTarget = fillMatch[1].replace(/^(输入框|字段)\s*/i, "").trim();
    return {
      action: "fill",
      target: targetFromText(rawTarget),
      value: withoutQuotes(fillMatch[2]),
    };
  }

  if (/^(点击|单击|click|tap)/.test(text)) {
    // “登录按钮”里的“按钮”是控件类型而非可见文本，保留它会让文本定位找不到登录入口。
    const rawTarget = text
      .replace(/^(点击|单击|click|tap)\s*(?:按钮)?\s*/i, "")
      .replace(/(?:按钮|链接)$/, "");
    if (!rawTarget) throw new Error("缺少点击目标");
    // 登录页常有标题和页签包含“登录”；登录/提交动作应收敛到唯一的 submit 按钮。
    if (/^(登录|提交)$/.test(rawTarget)) {
      return { action: "click", target: "button[type=submit]" };
    }
    return { action: "click", target: targetFromText(rawTarget) };
  }

  throw new Error(`暂不支持的指令：${text}`);
}

/** 按换行和普通分隔符拆句；不拆英文点号，避免破坏 URL 和文件路径。 */
export function parseNaturalLanguageScript(input: string): NaturalLanguageResult {
  const lines = input
    .split(/\r?\n|；|;|。(?!\d)/)
    .map((line) => line.trim())
    .filter(Boolean);
  const steps: AutomationStep[] = [];
  const errors: string[] = [];

  lines.forEach((line, index) => {
    try {
      const step = parseLine(line);
      if (step) steps.push(step);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`第 ${index + 1} 句：${message}`);
    }
  });

  if (!steps.length && !errors.length) {
    errors.push("自然语言脚本不能为空");
  }
  return { steps, errors };
}
