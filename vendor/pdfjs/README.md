# pdf.js（vendored）

来源：`pdfjs-dist@6.3.289` 的浏览器 ESM 构建（`build/pdf.min.mjs` + `build/pdf.worker.min.mjs`），Apache-2.0 协议。

本项目无构建工具链，不走 CDN（保证纯静态 GitHub Pages 环境可用、简历文本不经第三方网络），所以直接把发行版文件下载到本目录，通过原生 `import()` 动态加载，见 `resumes.js` 的 `loadPdfJs()`。

升级方法：从 `https://cdn.jsdelivr.net/npm/pdfjs-dist@<version>/build/` 重新下载 `pdf.min.mjs` 与 `pdf.worker.min.mjs` 替换本目录文件即可，两个文件版本号必须一致。
