/**
 * OTools 插件版的 Vite 配置（覆盖上游同名文件）。
 *
 * 与上游的两处差别：
 *   1. **不再引入 `../../dev/puter-localhost.mjs`**（以及 documents 的
 *      `./dev/collab-dev-server.mjs`）。上游那个插件把开发服务器挂在
 *      `<name>.puter.localhost`，是因为 Puter 的应用沙箱按子域名区分账号；
 *      插件版没有 Puter，直接跑 127.0.0.1 即可。而且 `dev/` 不在上游快照里
 *      （我们只快照 `src/documents`），留着这行会直接构建失败。
 *   2. **产物落到仓库根的 `dist/`**（`plugin.json` 的 `entry: dist/index.html`）。
 *      构建根目录是 `.build/`（upstream + 移植层的合成树），所以这里写 `../dist`。
 *
 * `base: './'` 是必须的：宿主用 `otools-plugin://<uuid>/dist/index.html` 提供
 * 插件，相对路径是唯一能同时适配「宿主加载」和「dist 拖进浏览器」的写法。
 */
import { defineConfig, configDefaults } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 找出「依赖上游夹具」的测试文件，把它们从测试集里剔掉。
 * ------------------------------------------------------------------
 * `scripts/sync-upstream.mjs` 的 `EXCLUDE_PATHS` 刻意不把
 * `tests/fixtures`、`public/fixtures` 带进快照 —— 那两个目录在上游是
 * **303 MB / 9868 个文件**，绝大多数是 .docx 二进制样本。为了它们把仓库
 * 从 51 MB 撑到 350 MB、让每次 clone 都背 300 MB，不值得。
 *
 * 代价是上游 935 个测试里有 638 个在 import 期就 `readFileSync()` 读夹具，
 * 直接 ENOENT 崩掉（649 个文件失败）。这些用例测的是文档引擎的排版/绘制
 * 细节，与移植层无关，但它们本来是上游防回归的主要屏障。
 *
 * 这里按**实际读夹具**来判定，而不是维护一份手写名单：上游改了测试也不会
 * 失配，夹具哪天被加回来这些用例会自动重新参与。判定依据是文件里出现了
 * `tests/fixtures` / `public/fixtures` 路径**并且**有磁盘读取 API。
 */
const FIXTURE_DIRS = ['tests/fixtures', 'public/fixtures'];

function fixtureDependentTests(testsDir) {
  if (!fs.existsSync(testsDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(testsDir)) {
    if (!name.endsWith('.test.js')) continue;
    const text = fs.readFileSync(path.join(testsDir, name), 'utf8');
    const mentionsFixture = FIXTURE_DIRS.some((d) => text.includes(d));
    const readsDisk = /readFileSync|fs\.readFile|readFile\(/.test(text);
    if (mentionsFixture && readsDisk) out.push(`tests/${name}`);
  }
  return out;
}

const configDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureTests = fixtureDependentTests(path.join(configDir, 'tests'));

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari16',
    chunkSizeWarningLimit: 1200,
    outDir: '../dist',
    // dist/ 的清扫交给 scripts/tree.mjs 的 sweepDist()：拿 Vite JS API 报回来的
    // 「本次产出了哪些文件」做差集，只删几个带哈希的旧 chunk，
    // 而不是把整个目录删掉重来。
    emptyOutDir: false,
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5520,
    strictPort: true,
    fs: {
      // 构建根是 `.build/`，而 node_modules 在仓库根（上一级）。不显式放行的话，
      // dev / vitest 会以 `Denied ID …/node_modules/…?url` 拒掉包内资源。
      allow: ['..'],
    },
  },
  worker: { format: 'es' },
  test: {
    // 上游的测试大多跑在 node 环境（文档/表格引擎不依赖 DOM），
    // 移植层自己的测试用文件头的 `// @vitest-environment jsdom` 单独声明。
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 30_000,
    // 夹具没进快照（见文件头「找出依赖上游夹具的测试文件」）：这些用例在
    // import 期就会 ENOENT，必须剔掉，否则整轮测试直接红。
    ...(fixtureTests.length ? { exclude: [...configDefaults.exclude, ...fixtureTests] } : {}),
  },
});
