// 云语音识别(ASR)配置存取。
// 密钥只保存在本地 Git 忽略文件 server/data/asr_config.local.json 中,
// 永不通过 API 返回给浏览器,也不进入任何前端代码或提交记录。
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 独立于 server.js 自行加载 dotenv,避免 ESM import 提升导致
// 模块顶层执行时 process.env 尚未被填充。legacy 目录兜底与 server.js 一致。
dotenv.config({ path: path.join(__dirname, "..", "..", ".env"), quiet: true });
const legacyBackendDir = path.resolve(
  process.env.YUN_LEGACY_BACKEND_DIR
    || "C:\\Users\\zhudo\\Documents\\Codex\\2026-05-28\\claude-ai-api-doctype-html-html"
);
dotenv.config({ path: path.join(legacyBackendDir, ".env"), quiet: true });

// 实时语音识别使用 WebSocket 连接,与 OpenAI 兼容模式的 baseUrl 不同。
// 这里同时记录 compatible 域(用于推导 WS 域名)与纯 WS 端点。
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "fun-asr-realtime";

function resolveDataDir() {
  if (process.env.YUN_DATA_DIR) return path.resolve(process.env.YUN_DATA_DIR);
  return path.resolve(__dirname, "..", "data");
}

export const asrConfigPath = () => path.join(resolveDataDir(), "asr_config.local.json");

function normalizeConfig(input = {}) {
  return {
    apiKey: String(input.apiKey ?? process.env.DASHSCOPE_API_KEY ?? "").trim(),
    baseUrl: String(input.baseUrl ?? process.env.DASHSCOPE_BASE_URL ?? DEFAULT_BASE_URL)
      .trim()
      .replace(/\/+$/, ""),
    model: String(input.model ?? process.env.ASR_MODEL ?? DEFAULT_MODEL).trim(),
  };
}

export function loadAsrConfig() {
  const configPath = asrConfigPath();
  try {
    if (existsSync(configPath)) {
      return normalizeConfig(JSON.parse(readFileSync(configPath, "utf8")));
    }
  } catch {
    // 配置损坏时按空配置处理,用户可在设置面板重新填写。
  }
  return normalizeConfig();
}

let cachedAsrConfig = loadAsrConfig();

export function getAsrConfig() {
  return { ...cachedAsrConfig };
}

export function getAsrStatus() {
  if (String(process.env.ASR_PROVIDER || "").trim() === "local-sensevoice") {
    return {
      status: "ASR_LOCAL",
      provider: "local-sensevoice",
      configured: true,
      baseUrl: String(process.env.YUN_LOCAL_SPEECH_URL || "http://127.0.0.1:17892").replace(/\/+$/, ""),
      model: String(process.env.SENSEVOICE_MODEL || "iic/SenseVoiceSmall"),
    };
  }
  const configured = Boolean(cachedAsrConfig.apiKey);
  return {
    status: configured ? "ASR_ONLINE" : "ASR_OFFLINE",
    provider: "dashscope-fun-asr-realtime",
    configured,
    baseUrl: cachedAsrConfig.baseUrl,
    model: cachedAsrConfig.model,
  };
}

export async function saveAsrConfig(next) {
  cachedAsrConfig = normalizeConfig(next);
  const configPath = asrConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(cachedAsrConfig, null, 2), "utf8");
  return getAsrStatus();
}

export async function clearAsrConfig() {
  cachedAsrConfig = normalizeConfig({ apiKey: "" });
  const configPath = asrConfigPath();
  if (existsSync(configPath)) {
    await writeFile(configPath, JSON.stringify(cachedAsrConfig, null, 2), "utf8");
  }
  return getAsrStatus();
}
