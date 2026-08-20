// 云语音识别(ASR)HTTP 路由 handlers。
// server.js 只负责把 /api/asr/* 请求转发到这里,所有业务逻辑隔离在本模块。
import multer from "multer";
import { getAsrStatus, saveAsrConfig, clearAsrConfig } from "./asrConfig.js";
import { detectWakeWord, transcribeAudio } from "./asrService.js";

const asrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function withBody(res, handler) {
  return readJsonBody(res.req)
    .then(handler)
    .catch((error) => sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : "请求体解析失败" }));
}

export function handleAsrStatus(req, res) {
  return sendJson(res, 200, { success: true, ...getAsrStatus() });
}

export function handleAsrConfigGet(req, res) {
  const status = getAsrStatus();
  // 永不返回 apiKey 本身,只返回是否已配置。
  return sendJson(res, 200, { success: true, ...status });
}

export function handleAsrConfigPost(req, res) {
  return withBody(res, async (body) => {
    const next = {
      apiKey: String(body.apiKey || "").trim(),
      baseUrl: String(body.baseUrl || "").trim(),
      model: String(body.model || "").trim(),
    };
    if (!next.apiKey) {
      return sendJson(res, 400, { success: false, error: "API Key 不能为空" });
    }
    const status = await saveAsrConfig(next);
    return sendJson(res, 200, { success: true, ...status });
  });
}

export function handleAsrConfigDelete(req, res) {
  return clearAsrConfig()
    .then((status) => sendJson(res, 200, { success: true, ...status }))
    .catch((error) => sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : "清除配置失败" }));
}

export function handleAsrTranscribe(req, res) {
  asrUpload.single("file")(req, res, (uploadError) => {
    if (uploadError) {
      return sendJson(res, 400, {
        success: false,
        error: uploadError?.code === "LIMIT_FILE_SIZE" ? "音频超过 10MB 限制" : "音频上传失败",
      });
    }
    const file = req.file;
    if (!file) {
      return sendJson(res, 400, { success: false, error: "缺少音频文件(multipart 字段名应为 file)" });
    }
    const language = String(req.body?.language || "zh").slice(0, 8);
    return transcribeAudio({ buffer: file.buffer, language })
      .then((result) => sendJson(res, 200, { success: true, ...result }))
      .catch((error) => {
        const code = error?.code;
        const status = code === "ASR_NOT_CONFIGURED" || code === "ASR_BAD_FORMAT" || code === "ASR_EMPTY_AUDIO"
          ? 400
          : code === "ASR_INVALID_KEY"
            ? 401
            : 502;
        return sendJson(res, status, { success: false, error: error.message, code });
      });
  });
}

export function handleAsrWakeDetect(req, res) {
  asrUpload.single("file")(req, res, (uploadError) => {
    if (uploadError) return sendJson(res, 400, { success: false, error: "唤醒音频上传失败" });
    if (!req.file) return sendJson(res, 400, { success: false, error: "缺少唤醒音频" });
    return detectWakeWord({ buffer: req.file.buffer })
      .then((result) => sendJson(res, 200, { success: true, ...result }))
      .catch((error) => sendJson(res, 502, { success: false, error: error.message, code: error.code }));
  });
}
