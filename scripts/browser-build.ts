export function buildBrowser(config: Omit<Bun.BuildConfig, "target">): Promise<Bun.BuildOutput> {
  return Bun.build({
    ...config,
    target: "browser",
    plugins: [
      {
        name: "inline-game-images",
        setup(build) {
          // 内嵌 PNG，便携版无需额外复制这些小图标。
          build.onLoad({ filter: /\.png$/ }, async ({ path }) => {
            const encoded = Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64");
            return { contents: `export default ${JSON.stringify(`data:image/png;base64,${encoded}`)};`, loader: "js" };
          });
        },
      },
      ...(config.plugins ?? []),
    ],
  });
}
