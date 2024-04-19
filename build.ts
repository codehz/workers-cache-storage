import { $, build, file, write } from "bun";
import dts from "bun-plugin-dts";

await $`rm -rf dist`;
const result = await build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  plugins: [
    dts({
      compilationOptions: {
        preferredConfigPath: "tsconfig.workers.json",
      },
    }),
  ],
});
result.logs.forEach(console.log);
if (!result.success) {
  process.exit(1);
}
await write(
  "dist/package.json",
  JSON.stringify(
    {
      ...(await file("./package.json").json()),
      module: "index.js",
      types: "index.d.ts",
      devDependencies: {},
      scripts: {},
    },
    null,
    2
  )
);
