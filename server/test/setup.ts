// Ambiente isolado para os testes: banco em memória e IA simulada
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arranque-test-"));
process.env.DATA_DIR = dir;
process.env.DB_FILE = ":memory:";
process.env.AI_PROVIDER = "mock";
process.env.DEBOUNCE_MS = "5";
process.env.TYPING_DELAY_MS = "0";
process.env.WA_PHONE_NUMBER_ID = "";
process.env.WA_ACCESS_TOKEN = "";
