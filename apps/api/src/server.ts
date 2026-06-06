import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.PORT ?? 8787);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`loopin-api listening on http://localhost:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
