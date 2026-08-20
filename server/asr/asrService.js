// 阿里云百炼实时语音识别(Fun-ASR-Realtime)WebSocket 转写服务。
// 协议(华北2北京 / DashScope):
//   wss://{host}/api-ws/v1/inference
//   Authorization: Bearer {apiKey}
// 时序:run-task(text) → task-started → 二进制 PCM(16kHz 单声道) → finish-task(text)
//       → result-generated*(text) → task-finished / task-failed → close
// 参考:https://platform.qianwenai.com/docs/api-reference/speech-recognition/paraformer-realtime/websocket-api
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { getAsrConfig } from "./asrConfig.js";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 上传原始音频上限(前端 WAV)
const TARGET_SAMPLE_RATE = 16000; // Fun-ASR 推荐的识别采样率
const AUDIO_CHUNK_BYTES = 2048; // 二进制音频分块(16bit 单声道 ≈ 64ms)
const AUDIO_CHUNK_DELAY_MS = 25;
const CONNECT_TIMEOUT_MS = 10_000; // WS 握手超时
const START_TIMEOUT_MS = 10_000; // 等待 task-started 超时
const TOTAL_TIMEOUT_MS = 60_000; // 单次任务总超时

function asrError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function transcribeWithLocalSenseVoice({ buffer, language }) {
  const baseUrl = String(process.env.YUN_LOCAL_SPEECH_URL || "http://127.0.0.1:17892").replace(/\/+$/, "");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), "speech.wav");
  form.append("language", language || "zh");
  let response;
  try {
    response = await fetch(`${baseUrl}/asr/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TOTAL_TIMEOUT_MS),
    });
  } catch (error) {
    throw asrError(`本地 SenseVoice 服务不可用：${error instanceof Error ? error.message : "连接失败"}`, "ASR_UPSTREAM_ERROR");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw asrError(body.detail || body.error || "本地 SenseVoice 转写失败", "ASR_UPSTREAM_ERROR");
  }
  const text = String(body.text || "").trim();
  if (!text) throw asrError("本地 SenseVoice 没有识别到语音", "ASR_EMPTY_RESULT");
  return {
    text,
    language: body.language || language,
    durationSeconds: body.durationSeconds ?? null,
    model: body.model || "iic/SenseVoiceSmall",
  };
}

async function detectWakeWordWithLocalKws({ buffer }) {
  const baseUrl = String(process.env.YUN_LOCAL_SPEECH_URL || "http://127.0.0.1:17892").replace(/\/+$/, "");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), "wake.wav");
  let response;
  try {
    response = await fetch(`${baseUrl}/wake/detect`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    throw asrError(`本地唤醒服务不可用：${error instanceof Error ? error.message : "连接失败"}`, "ASR_UPSTREAM_ERROR");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw asrError(body.detail || body.error || "本地唤醒检测失败", "ASR_UPSTREAM_ERROR");
  }
  return {
    detected: Boolean(body.detected),
    keyword: String(body.keyword || ""),
    elapsedMs: Number(body.elapsedMs || 0),
  };
}

// ---------- WAV 解析与重采样 ----------

// 解析 16-bit PCM WAV,返回 { samples: Float32Array(单声道), sampleRate }。
// 立体声按声道平均降混。仅支持 PCM 编码。
export function parsePcmWav(buffer) {
  if (buffer.length < 44) throw asrError("音频数据不完整", "ASR_EMPTY_AUDIO");
  const readText = (offset, length) => buffer.toString("latin1", offset, offset + length);
  if (readText(0, 4) !== "RIFF" || readText(8, 4) !== "WAVE") {
    throw asrError("仅支持 WAV(PCM)音频格式", "ASR_BAD_FORMAT");
  }

  let dataOffset = -1;
  let dataLength = 0;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = readText(offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === "fmt " && chunkSize >= 16) {
      const audioFormat = buffer.readUInt16LE(chunkStart);
      if (audioFormat !== 1) {
        throw asrError("仅支持未压缩 PCM 编码的 WAV", "ASR_BAD_FORMAT");
      }
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
      if (bitsPerSample !== 16) {
        throw asrError("仅支持 16-bit 采样位深的 WAV", "ASR_BAD_FORMAT");
      }
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataLength = Math.min(chunkSize, Math.max(0, buffer.length - chunkStart));
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || dataLength <= 0) {
    throw asrError("音频中没有可识别的数据段", "ASR_EMPTY_AUDIO");
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 192000) {
    throw asrError("WAV 采样率字段异常", "ASR_BAD_FORMAT");
  }
  if (channels < 1 || channels > 8) {
    throw asrError("WAV 声道数异常", "ASR_BAD_FORMAT");
  }

  const frameCount = Math.floor(dataLength / 2 / channels);
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const int16 = buffer.readInt16LE(dataOffset + (frame * channels + channel) * 2);
      sum += int16 / 0x8000;
    }
    samples[frame] = sum / channels;
  }

  return { samples, sampleRate };
}

// 线性插值重采样(语音识别场景足够;避免引入额外依赖)。
export function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const output = new Float32Array(outLength);
  for (let index = 0; index < outLength; index += 1) {
    const position = index / ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const frac = position - left;
    output[index] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
}

// Float32 采样 → 16-bit PCM Buffer(单声道)。
export function encodePcm16(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, index * 2);
  }
  return buffer;
}

// ---------- WebSocket 转写 ----------

function buildWsUrl(baseUrl) {
  try {
    const host = new URL(baseUrl).host;
    return `wss://${host}/api-ws/v1/inference`;
  } catch {
    return "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
  }
}

export { buildWsUrl };

// Fun-ASR 的 result-generated 是累积式:同一句子的 text 逐次增长,
// end_time 非 null 才表示该句结束。interim 结果只更新当前句,
// 只有句子结束时才提交到最终结果,避免长句重复累积。
export function createSentenceAccumulator() {
  let finalParts = [];
  let currentText = "";

  return {
    push(sentence) {
      const text = String(sentence?.text || "").trim();
      if (!text) return;
      if (sentence?.end_time != null) {
        finalParts.push(text);
        currentText = "";
      } else {
        currentText = text;
      }
    },
    finish() {
      if (currentText) finalParts.push(currentText);
      return finalParts.join("").trim();
    },
  };
}

export async function transcribeAudio({ buffer, language = "zh" }) {
  if (String(process.env.ASR_PROVIDER || "").trim() === "local-sensevoice") {
    return transcribeWithLocalSenseVoice({ buffer, language });
  }
  const config = getAsrConfig();
  if (!config.apiKey) {
    throw asrError("未配置阿里云百炼 API Key,请先在语音设置中填写", "ASR_NOT_CONFIGURED");
  }
  if (!buffer?.length) {
    throw asrError("缺少音频内容", "ASR_EMPTY_AUDIO");
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw asrError(`音频过大(${Math.round(buffer.length / 1024)}KB),超过 10MB 限制`, "ASR_AUDIO_TOO_LARGE");
  }

  // 1. 解析 WAV 并统一为 16kHz 单声道 PCM。
  let parsed;
  try {
    parsed = parsePcmWav(buffer);
  } catch (error) {
    if (error?.code) throw error;
    throw asrError("音频解析失败", "ASR_BAD_FORMAT");
  }
  const resampled = resampleLinear(parsed.samples, parsed.sampleRate, TARGET_SAMPLE_RATE);
  const pcm16 = encodePcm16(resampled);
  if (pcm16.length < 320) {
    // 少于 10ms@16k 的音频没有任何可识别内容。
    throw asrError("音频太短,无法识别", "ASR_EMPTY_AUDIO");
  }

  const model = config.model || "fun-asr-realtime";
  const taskId = randomUUID().replace(/-/g, "").slice(0, 32);
  const wsUrl = buildWsUrl(config.baseUrl);

  return new Promise((resolve, reject) => {
    let settled = false;
    let taskStarted = false;
    let taskFinished = false;
    const accumulator = createSentenceAccumulator();
    const timers = [];

    const cleanup = (ws) => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.length = 0;
      try {
        ws?.removeAllListeners();
        if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        }
      } catch {
        // 忽略关闭期间的异常。
      }
    };

    const settle = (ws, kind, payload) => {
      if (settled) return;
      settled = true;
      cleanup(ws);
      if (kind === "resolve") resolve(payload);
      else reject(payload);
    };

    const fail = (ws, error) => settle(ws, "reject", error);

    let ws;
    try {
      ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        handshakeTimeout: CONNECT_TIMEOUT_MS,
      });
    } catch (error) {
      return reject(asrError(`无法连接语音识别服务:${error.message}`, "ASR_UPSTREAM_ERROR"));
    }

    timers.push(setTimeout(() => {
      fail(ws, asrError("语音识别连接超时", "ASR_TIMEOUT"));
    }, TOTAL_TIMEOUT_MS));

    const sendRunTask = () => {
      if (settled) return;
      const runTask = {
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: {
          task_group: "audio",
          task: "asr",
          function: "recognition",
          model,
          parameters: {
            format: "pcm",
            sample_rate: TARGET_SAMPLE_RATE,
          },
          input: {},
        },
      };
      ws.send(JSON.stringify(runTask));
    };

    const sendAudio = () => {
      let position = 0;
      const pushChunk = () => {
        if (settled || taskFinished) return;
        if (position >= pcm16.length) {
          sendFinishTask();
          return;
        }
        const chunk = pcm16.subarray(position, position + AUDIO_CHUNK_BYTES);
        position += chunk.length;
        try {
          ws.send(chunk);
        } catch (error) {
          fail(ws, asrError(`发送音频失败:${error.message}`, "ASR_UPSTREAM_ERROR"));
          return;
        }
        timers.push(setTimeout(pushChunk, AUDIO_CHUNK_DELAY_MS));
      };
      pushChunk();
    };

    const sendFinishTask = () => {
      if (settled || taskFinished) return;
      taskFinished = true;
      const finishTask = {
        header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
        payload: { input: {} },
      };
      try {
        ws.send(JSON.stringify(finishTask));
      } catch (error) {
        fail(ws, asrError(`结束任务失败:${error.message}`, "ASR_UPSTREAM_ERROR"));
      }
    };

    ws.on("open", () => {
      if (settled) return;
      sendRunTask();
      // 等待 task-started 超时兜底。
      timers.push(setTimeout(() => {
        if (!settled && !taskStarted) {
          fail(ws, asrError("语音识别任务启动超时", "ASR_TIMEOUT"));
        }
      }, START_TIMEOUT_MS));
    });

    ws.on("message", (data) => {
      if (settled) return;
      let event;
      try {
        event = JSON.parse(String(data));
      } catch {
        return; // 非 JSON 帧忽略(如二进制回显)。
      }
      const eventName = event?.header?.event;

      if (eventName === "task-started") {
        taskStarted = true;
        sendAudio();
        return;
      }
      if (eventName === "result-generated") {
        const sentence = event?.payload?.output?.sentence;
        if (sentence?.text) accumulator.push(sentence);
        return;
      }
      if (eventName === "task-finished") {
        const text = accumulator.finish();
        if (!text) {
          fail(ws, asrError("语音识别未返回文字,请确认音频里有人声", "ASR_EMPTY_RESULT"));
          return;
        }
        settle(ws, "resolve", {
          text,
          language,
          durationSeconds: event?.payload?.usage?.duration ?? null,
          model,
        });
        return;
      }
      if (eventName === "task-failed") {
        const message = event?.header?.error_message || event?.payload?.message || "语音识别任务失败";
        fail(ws, asrError(`语音识别失败:${message}`, "ASR_UPSTREAM_ERROR"));
      }
    });

    ws.on("error", (error) => {
      const message = String(error?.message || "");
      if (/401|403|unauthorized|invalid.*api.*key|forbidden/i.test(message)) {
        fail(ws, asrError("阿里云 API Key 无效或未授权", "ASR_INVALID_KEY"));
        return;
      }
      fail(ws, asrError(`语音识别连接异常:${message || "网络错误"}`, "ASR_UPSTREAM_ERROR"));
    });

    ws.on("close", (code) => {
      if (settled) return;
      // 握手阶段关闭通常是鉴权失败(401/403)。
      if (!taskStarted) {
        fail(ws, asrError("语音识别服务连接被拒绝,请检查 API Key", "ASR_INVALID_KEY"));
        return;
      }
      if (code !== 1000) {
        fail(ws, asrError(`语音识别连接意外中断(${code})`, "ASR_UPSTREAM_ERROR"));
        return;
      }
      fail(ws, asrError("语音识别连接提前关闭", "ASR_UPSTREAM_ERROR"));
    });
  });
}

export async function detectWakeWord({ buffer }) {
  if (!buffer?.length) throw asrError("缺少唤醒音频", "ASR_EMPTY_AUDIO");
  if (buffer.length > 2 * 1024 * 1024) throw asrError("唤醒音频过大", "ASR_AUDIO_TOO_LARGE");
  return detectWakeWordWithLocalKws({ buffer });
}
