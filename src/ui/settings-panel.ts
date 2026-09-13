/**
 * 设置面板：配色方案、动画速度、操作说明、成绩记录。
 */

import { FACE_COLOR_KEYS, FACE_COLOR_LABELS, builtinThemes } from '../shared/themes';
import { Settings } from './settings';

const SPEEDS: { label: string; value: number }[] = [
  { label: '慢', value: 0.6 },
  { label: '标准', value: 1 },
  { label: '快', value: 1.8 },
  { label: '极快', value: 3 },
];

export function renderSettingsPanel(
  root: HTMLElement,
  settings: Settings,
  onChange: (patch: Partial<Settings>) => void,
): void {
  root.innerHTML = '';

  // --- 配色方案 ---
  const themeSetting = setting('配色方案', '决定魔方贴纸的颜色，自定义方案可以逐面调色。');
  const themeRow = document.createElement('div');
  themeRow.className = 'segmented';
  for (const theme of builtinThemes()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = theme.name.replace('配色', '');
    btn.className = settings.themeId === theme.id ? 'active' : '';
    btn.addEventListener('click', () => onChange({ themeId: theme.id }));
    themeRow.appendChild(btn);
  }
  themeSetting.appendChild(themeRow);
  root.appendChild(themeSetting);

  // --- 自定义颜色 ---
  if (settings.themeId === 'custom') {
    const custom = setting('自定义颜色', '点击色块即可取色，修改后会立刻应用到魔方上。');
    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    for (const key of FACE_COLOR_KEYS) {
      grid.appendChild(colorSwatch(FACE_COLOR_LABELS[key], settings.customFace[key], (v) => {
        onChange({ customFace: { ...settings.customFace, [key]: v } });
      }));
    }
    grid.appendChild(colorSwatch('本体', settings.customBody, (v) => onChange({ customBody: v })));
    grid.appendChild(colorSwatch('镜面', settings.customMirror, (v) => onChange({ customMirror: v })));
    custom.appendChild(grid);
    root.appendChild(custom);
  }

  // --- 动画速度 ---
  const speedSetting = setting('转动速度', '影响拧动时的动画时长，也可以选「极快」接近瞬移。');
  const speedRow = document.createElement('div');
  speedRow.className = 'segmented';
  for (const s of SPEEDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = s.label;
    btn.className = Math.abs(settings.speed - s.value) < 0.01 ? 'active' : '';
    btn.addEventListener('click', () => onChange({ speed: s.value }));
    speedRow.appendChild(btn);
  }
  speedSetting.appendChild(speedRow);
  root.appendChild(speedSetting);

  // --- 操作说明 ---
  const help = setting('操作说明', '');
  const list = document.createElement('div');
  list.className = 'help-list';
  list.innerHTML = [
    '<b>拖动贴纸</b>：转动该块所在的层，方向随拖动方向',
    '<b>拖空白处 / 右键拖动</b>：旋转视角',
    '<b>滚轮</b>：缩放',
    '<b>Shift + 拖动</b>：宽层转（4/5 阶常用）',
    '<b>点内层贴纸</b>：只转该内层（切片转）',
    '<b>方向键</b>：微调视角',
    '<b>Z / Y</b>：撤销 / 重做思路校验 · <b>空格</b>：打乱',
  ].join('<br />');
  help.appendChild(list);
  root.appendChild(help);

  // --- 记录 ---
  const records = setting('成绩记录', '复原成功后会记录该魔方的最快时间。');
  const bestCount = Object.keys(settings.bestTimes).length;
  const clear = document.createElement('div');
  clear.className = 'segmented';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = `清空记录（${bestCount} 项）`;
  btn.disabled = bestCount === 0;
  btn.addEventListener('click', () => onChange({ bestTimes: {} }));
  clear.appendChild(btn);
  records.appendChild(clear);
  root.appendChild(records);
}

function setting(label: string, hint: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'setting';
  const title = document.createElement('div');
  title.className = 'setting-label';
  title.textContent = label;
  wrap.appendChild(title);
  if (hint) {
    const h = document.createElement('div');
    h.className = 'setting-hint';
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}

function colorSwatch(label: string, value: string, onInput: (v: string) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'swatch';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = normalize(value);
  input.addEventListener('input', () => onInput(input.value));
  const span = document.createElement('span');
  span.textContent = label;
  wrap.appendChild(input);
  wrap.appendChild(span);
  return wrap;
}

function normalize(hex: string): string {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h.padEnd(6, '0').slice(0, 6);
}
