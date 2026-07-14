import { buildApp } from "./app";
import { env } from "./env";

const app = buildApp();

app.listen({ port: env.PORT, host: "::" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
