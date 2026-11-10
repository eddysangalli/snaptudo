"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const executable = process.argv[2];
const action = process.argv[3] || "ping";
if (!executable) {
  console.error("Uso: node scripts/native-host-smoke.js <sidecar.exe> [ping|startDownload] [video|audio] [url]");
  process.exit(2);
}

const message = action === "startDownload"
  ? { action, mode: process.argv[4] || "video", url: process.argv[5] }
  : { action };
const payload = Buffer.from(JSON.stringify(message), "utf8");
const header = Buffer.alloc(4);
header.writeUInt32LE(payload.length, 0);

const child = spawn(path.resolve(executable), [], { stdio: ["pipe", "pipe", "inherit"] });
const chunks = [];
child.stdout.on("data", chunk => chunks.push(chunk));
child.stdin.end(Buffer.concat([header, payload]));

child.on("close", code => {
  const response = Buffer.concat(chunks);
  if (code !== 0) throw new Error(`Sidecar saiu com código ${code}`);
  if (response.length < 4) throw new Error("Resposta nativa vazia");
  const length = response.readUInt32LE(0);
  const body = response.subarray(4, 4 + length);
  if (body.length !== length) throw new Error("Resposta nativa incompleta");
  console.log(JSON.stringify(JSON.parse(body.toString("utf8")), null, 2));
});
