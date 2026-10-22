const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    if (new URL(request.url).pathname === "/resource") {
      return new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode("new"));
          },
        }),
      );
    }
    return new Response("ok");
  },
});
postMessage(server.port);
export {};
