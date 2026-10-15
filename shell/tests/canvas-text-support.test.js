// @vitest-environment jsdom
/**
 * Canvas 文本能力补丁的边界。
 *
 * 这层存在的唯一理由：上游 `setCanvasTextStyle` 拿不到 `fontKerning` 就抛错，
 * 整份文档打不开；而 macOS 的 WKWebView 至今没有这个属性。所以这里测的是
 * 「补丁装上之后，上游那段代码能跑完」——不是测排版效果（那是上游的事）。
 */
import { describe, expect, it } from 'vitest';

import { canvasTextSupport, installCanvasTextSupport } from '../src/otools/canvas-text-support.js';

/** 造一个假的宿主：只带 Canvas 构造器，属性按传入的清单决定有没有。 */
function fakeHost(...present) {
  class FakeContext {}
  for (const name of present) {
    Object.defineProperty(FakeContext.prototype, name, {
      configurable: true,
      get: () => (name === 'fontKerning' ? 'auto' : '0px'),
      set: () => {},
    });
  }
  return { CanvasRenderingContext2D: FakeContext };
}

/** 上游 setCanvasTextStyle 的能力守卫，原样搬过来当断言对象。 */
function upstreamGuards(context, style = {}) {
  const steps = [];
  if (!('fontKerning' in context)) throw new Error('This browser cannot control font kerning.');
  context.fontKerning = style.kerning ? 'normal' : 'none';
  steps.push(context.fontKerning);
  if ('letterSpacing' in context) context.letterSpacing = `${(style.characterSpacing || 0) * 4 / 3}px`;
  else if (style.characterSpacing) throw new Error('This browser cannot display character spacing.');
  if ('wordSpacing' in context) context.wordSpacing = `${style.justificationSpacing || 0}px`;
  else if (style.justificationSpacing) throw new Error('This browser cannot display justified text.');
  return steps;
}

describe('缺失属性的补齐', () => {
  it('WebKit 这种一个都没有的宿主，补完后上游的守卫全部通过', () => {
    const host = fakeHost();
    expect(canvasTextSupport(host).canvas).toEqual({ fontKerning: true, letterSpacing: true, wordSpacing: true });

    expect(installCanvasTextSupport(host)).toEqual({ fontKerning: true, letterSpacing: true, wordSpacing: true });

    const context = new host.CanvasRenderingContext2D();
    // 上游 validateCanvasTextSupport 会用空 style 先跑一遍
    expect(() => upstreamGuards(context, {})).not.toThrow();
    // 再用带字符间距与两端对齐的 style 跑一遍——这两条是另两个守卫
    expect(() => upstreamGuards(context, { kerning: 14, characterSpacing: 1, justificationSpacing: 2 })).not.toThrow();
  });

  it('原生的一个都不碰', () => {
    const host = fakeHost('fontKerning', 'letterSpacing', 'wordSpacing');
    expect(installCanvasTextSupport(host)).toEqual({ fontKerning: false, letterSpacing: false, wordSpacing: false });

    const context = new host.CanvasRenderingContext2D();
    expect(context.fontKerning).toBe('auto'); // 仍是原生初始值，没被改成 'normal'
  });

  it('只补缺的那几个', () => {
    const host = fakeHost('letterSpacing');
    expect(installCanvasTextSupport(host)).toEqual({ fontKerning: true, letterSpacing: false, wordSpacing: true });
    expect(canvasTextSupport(host).canvas).toEqual({ fontKerning: false, letterSpacing: false, wordSpacing: false });
  });

  it('重复安装不叠加、第二次报告全 false', () => {
    const host = fakeHost();
    installCanvasTextSupport(host);
    expect(installCanvasTextSupport(host)).toEqual({ fontKerning: false, letterSpacing: false, wordSpacing: false });
    expect(() => upstreamGuards(new host.CanvasRenderingContext2D())).not.toThrow();
  });
});

describe('no-op 的语义', () => {
  it('赋值不抛错，且读回来是 WebKit 的真实行为', () => {
    const host = fakeHost();
    installCanvasTextSupport(host);
    const context = new host.CanvasRenderingContext2D();
    // 上游 setCanvasTextStyle 每次绘制前都会重写这几个值
    expect(() => {
      context.fontKerning = 'none';
      context.letterSpacing = '2.6667px';
      context.wordSpacing = '4px';
    }).not.toThrow();
    // getter 报告「一直应用字距」——WebKit 的 Canvas 就是这个行为，
    // 上游把它喂给 CSS 探针时两端才对得上
    expect(context.fontKerning).toBe('normal');
    expect(context.letterSpacing).toBe('0px');
    expect(context.wordSpacing).toBe('0px');
  });

  it('不同 context 之间互不影响', () => {
    const host = fakeHost();
    installCanvasTextSupport(host);
    const a = new host.CanvasRenderingContext2D();
    const b = new host.CanvasRenderingContext2D();
    a.fontKerning = 'none';
    expect(b.fontKerning).toBe('normal');
  });
});

describe('宿主没有 Canvas 的情况', () => {
  it('不抛错，只报告什么都没补', () => {
    expect(installCanvasTextSupport({})).toEqual({ fontKerning: false, letterSpacing: false, wordSpacing: false });
    expect(canvasTextSupport({}).canvas).toBeNull();
  });

  it('构造器存在但没有 prototype（脏 polyfill）也不炸', () => {
    expect(() => installCanvasTextSupport({ CanvasRenderingContext2D: function () {} })).not.toThrow();
  });
});
