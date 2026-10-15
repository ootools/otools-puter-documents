/**
 * Canvas 文本能力补丁：让缺 `fontKerning` 的宿主 WebView 也能打开文档。
 * ------------------------------------------------------------------
 * 上游的排版引擎把 Canvas 的三个文本样式属性当**硬前提**
 * （`upstream/src/engine/canvas-text.js` 的 `setCanvasTextStyle`）：
 *
 * ```js
 * if (!('fontKerning' in context)) throw new Error('This browser cannot control font kerning…');
 * context.fontKerning = kerningEnabled(style) ? 'normal' : 'none';
 * if ('letterSpacing' in context) context.letterSpacing = `${…}px`;
 * else if (style.characterSpacing) throw new Error('This browser cannot display character spacing…');
 * ```
 *
 * 缺任何一个都是直接抛错——不是降级、不是警告，是**整份文档打不开**。
 * 这是上游自己的选择（conformance 文档里明写了「Reject browsers lacking
 * Canvas font-kerning control before attaching an editor/save handler」），
 * 在浏览器里合理：那里用户换个 Chrome/Edge 就好了。
 *
 * 但 OTools 桌面端不是浏览器。macOS 上 Tauri 用的是**系统的 WKWebView**，
 * 而 `fontKerning` 是 Chrome 99 / Firefox 104 才加的新属性，**WebKit 至今
 * 没有实现**（Safari 27 仍不支持，见 MDN 兼容表）。也就是说这个插件在 macOS
 * 上是「必然打不开文档」的状态，用户换不掉内核。
 *
 * 所以这一层只做一件事：**把缺失的属性补上，让上游的守卫不再触发**。
 * 上游核心逻辑一行不动——它照常决定 kerning 该开该关，我们只是让这些赋值
 * 有地方落。
 *
 * ## 补的是 no-op，不是实现
 *
 * 这里刻意**不**去模拟 kerning 的效果（比如用 CSS 探针逐字测量再补偿）。
 * 排版引擎对「测量」和「绘制」有一致性要求：两者必须走同一条路径、用同一套
 * 规则，否则「量出来的宽度」和「画出来的宽度」对不上，文字溢出单元格、换行
 * 位置漂移——那比少一个 kerning 特性糟糕得多。
 *
 * 补成 no-op 之后，测量与绘制都落在 WebKit 自己的默认行为上（WebKit 的
 * Canvas 一直应用字距调整），两边天然一致。代价是：文档里显式声明「关闭
 * 字距调整」（`w:kern` 为 0）的地方，视觉上仍会带字距。这是一处**保真度**
 * 损失，换来文档能打开、能编辑、能保存——对插件来说这个交易划算。字距调整
 * 是亚像素级的排版细节，不影响文字内容。
 *
 * 另一处用到 kerning 的地方（`shaped-carets.js` 把 `context.fontKerning` 喂给
 * 一个隐藏 DOM span 做光标定位）在补丁下拿到 `'normal'`，而 CSS 的
 * `font-kerning: normal` 是 WebKit **支持**的，于是 DOM 探针与 Canvas 绘制
 * 恰好都按「应用字距」走，仍然一致。
 *
 * 幂等：重复调用只补一次；原生支持的属性一律不碰。
 */

/**
 * getter 必须返回的初始值。
 *
 * `fontKerning` 用 `'normal'` 而不是规范初始的 `'auto'`：WebKit 的 Canvas
 * 实际一直在应用字距调整，`'normal'` 才是**它真实的行为**，返回真值才能让
 * 上游喂给 CSS 探针的那一端也对得上（见文件头末段）。
 */
const INITIAL = {
  fontKerning: 'normal',
  letterSpacing: '0px',
  wordSpacing: '0px',
};

const INSTALLED = Symbol.for('otools.canvasTextSupport');

/** 给一个原型装上 no-op 访问器，返回是否真的补了。 */
function defineNoop(proto, name) {
  if (name in proto) return false; // 原生就有，绝不覆盖
  const initial = INITIAL[name];
  Object.defineProperty(proto, name, {
    configurable: true,
    enumerable: false,
    // 无论上游写入什么，都报告 WebKit 实际在用的行为。写入被有意忽略：
    // 我们不模拟效果，只保证「赋值不抛错」且「读回来的值与实际绘制一致」。
    get: () => initial,
    set: () => {},
  });
  return true;
}

/** 在一个构造器原型上补齐缺失的属性，返回补了哪些。 */
function patchPrototype(Ctor) {
  if (!Ctor || !Ctor.prototype) return [];
  const proto = Ctor.prototype;
  if (proto[INSTALLED]) return [];
  const added = Object.keys(INITIAL).filter((name) => defineNoop(proto, name));
  Object.defineProperty(proto, INSTALLED, { value: true, enumerable: false });
  return added;
}

/**
 * 补齐宿主 Canvas 上下文缺失的文本样式属性。
 *
 * 必须在任何 Canvas 绘制发生**之前**调用——`boot.js` 是插件入口的第一个
 * import，位置天然正确。
 *
 * @param {{CanvasRenderingContext2D?:Function, OffscreenCanvasRenderingContext2D?:Function}} [scope]
 *   宿主全局对象。仅测试用来注入替身；生产不要传。
 * @returns {{fontKerning:boolean, letterSpacing:boolean, wordSpacing:boolean}}
 *   每项表示该属性是不是我们补的（`false` = 原生就有，或宿主根本没有 Canvas）。
 */
export function installCanvasTextSupport(scope = globalThis) {
  const added = [
    ...patchPrototype(scope.CanvasRenderingContext2D),
    ...patchPrototype(scope.OffscreenCanvasRenderingContext2D),
  ];
  return Object.fromEntries(Object.keys(INITIAL).map((name) => [name, added.includes(name)]));
}

/**
 * 宿主 Canvas 缺了哪些文本样式属性（`true` 表示缺）。
 *
 * 排查用：控制台敲 `otoolsCanvasTextSupport()` 就知道这次运行里哪些属性是
 * 补丁撑起来的。**只读不装**——只想知道现状而不改环境时用这个。
 */
export function canvasTextSupport(scope = globalThis) {
  const probe = (Ctor) => {
    if (!Ctor || !Ctor.prototype) return null;
    const proto = Ctor.prototype;
    return Object.fromEntries(Object.keys(INITIAL).map((name) => [name, !(name in proto)]));
  };
  return {
    canvas: probe(scope.CanvasRenderingContext2D),
    offscreen: probe(scope.OffscreenCanvasRenderingContext2D),
  };
}
