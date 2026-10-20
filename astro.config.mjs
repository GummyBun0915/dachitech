// @ts-check
import { defineConfig } from "astro/config";

// D2（DECISIONS.md）2026-09-16 复议：改 GitHub Pages 部署，平台支持目录路由与真 404 →
// 升级为目录式 URL。项目仓部署在 /dachitech/ 子路径下，需 base。
// 2026-09-25 公开仓已迁到 GummyBun0915/dachitech。
// 站点：https://gummybun0915.github.io/dachitech/
export default defineConfig({
  site: "https://gummybun0915.github.io",
  base: "/dachitech/",
  output: "static",
  build: { format: "directory" },
  trailingSlash: "always",
  compressHTML: true,
});
