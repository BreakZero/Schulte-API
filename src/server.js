import http from "node:http";
import { SchulteApi } from "./app.js";
import { FileStore } from "./store.js";

const port = Number(process.env.PORT || 8080);
const dataFile = process.env.DATA_FILE || "data/store.json";
const api = new SchulteApi(new FileStore(dataFile));

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  const result = await api.handle(req.method, req.url, req.headers, Buffer.concat(chunks));
  res.writeHead(result.status, result.headers);
  res.end(result.body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Schulte API listening on http://127.0.0.1:${port}/api/v1`);
  console.log(`Data file: ${dataFile}`);
});
