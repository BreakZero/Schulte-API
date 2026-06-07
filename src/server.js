import http from "node:http";
import { SchulteApi } from "./app.js";
import { DsqlStore } from "./dsql-store.js";
import { loadEnv } from "./env.js";
import { FileStore } from "./store.js";

loadEnv();

const port = Number(process.env.PORT || 8080);
const dataFile = process.env.DATA_FILE || "data/store.json";
const dataStore = (process.env.DATA_STORE || (process.env.DSQL_HOST ? "dsql" : "file")).toLowerCase();
const store = await createStore();
const api = new SchulteApi(store);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  const result = await api.handle(req.method, req.url, req.headers, Buffer.concat(chunks));
  res.writeHead(result.status, result.headers);
  res.end(result.body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Schulte API listening on http://127.0.0.1:${port}/api/v1`);
  console.log(dataStore === "dsql" ? `Data store: Aurora DSQL (${process.env.DSQL_HOST})` : `Data file: ${dataFile}`);
});

async function createStore() {
  if (dataStore === "file") return new FileStore(dataFile);
  if (dataStore !== "dsql") {
    throw new Error(`Unsupported DATA_STORE value: ${dataStore}`);
  }
  if (!process.env.DSQL_HOST) {
    throw new Error("DSQL_HOST is required when DATA_STORE=dsql");
  }

  const dsqlStore = new DsqlStore({
    host: process.env.DSQL_HOST,
    port: Number(process.env.DSQL_PORT || 5432),
    database: process.env.DSQL_DATABASE || "postgres",
    user: process.env.DSQL_USER || "admin",
    password: process.env.DSQL_PASSWORD,
    region: process.env.AWS_REGION,
    profile: process.env.AWS_PROFILE,
    poolSize: process.env.DSQL_POOL_SIZE,
    tokenExpiresIn: process.env.DSQL_TOKEN_EXPIRES_IN
  });
  await dsqlStore.init();
  return dsqlStore;
}
