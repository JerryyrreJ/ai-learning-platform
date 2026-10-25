import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

// Compile the production components and stylesheet; only auth and navigation are
// replaced. The browser test must intercept every project API request.
async function main() {
  const root = process.cwd();
  const baseline = process.env.DESKTOP_FIXTURE_BASELINE;
  const baselineFiles = new Set([
    "src/components/projects/desktop/Desktop.tsx",
    "src/components/projects/desktop/Window.tsx",
    "src/components/projects/desktop/apps/NotesApp.tsx",
  ]);
  const js = await build({
    entryPoints: ["tests/browser/fixture.tsx"],
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@/lib/auth-store": resolve(root, "tests/browser/mock-auth.ts"),
      "next/link": resolve(root, "tests/browser/mock-link.tsx"),
    },
    plugins: baseline
      ? [{
          name: "read-baseline-without-changing-checkout",
          setup(builder) {
            builder.onLoad({ filter: /\.tsx$/ }, (args) => {
              const path = relative(root, args.path).replaceAll("\\", "/");
              if (!baselineFiles.has(path)) return;
              return {
                contents: execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" }),
                loader: "tsx",
                resolveDir: resolve(args.path, ".."),
              };
            });
          },
        }]
      : [],
  });
  const cssPath = resolve(root, "src/app/globals.css");
  const css = await postcss([tailwindcss({ base: root })]).process(await readFile(cssPath, "utf8"), { from: cssPath });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><title>Desktop regression fixture</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;

  createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/fixture.js") {
      res.writeHead(200, { "content-type": "text/javascript" }).end(js.outputFiles[0].text);
    } else if (path === "/fixture.css") {
      res.writeHead(200, { "content-type": "text/css" }).end(css.css);
    } else if (path === "/") {
      res.writeHead(200, { "content-type": "text/html" }).end(html);
    } else {
      res.writeHead(404).end("Fixture request was not intercepted.");
    }
  }).listen(4177, "127.0.0.1");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
