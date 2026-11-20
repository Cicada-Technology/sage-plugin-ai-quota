import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 单文件 ESM：宿主用 blob URL 加载 main.js，裸导入无法解析。
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  build: {
    outDir: ".",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: "src/main.tsx",
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        banner: "var process = { env: { NODE_ENV: 'production' } };",
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css") ? "styles.css" : (asset.name ?? "asset"),
      },
    },
  },
});
