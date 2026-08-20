// ASR 内部纯函数测试:WAV 解析、重采样、PCM 编码、URL 推导、句子累积。
// 运行:node server/asr/asrService.test.mjs
import assert from "node:assert/strict";
import {
  parsePcmWav,
  resampleLinear,
  encodePcm16,
  buildWsUrl,
  createSentenceAccumulator,
} from "./asrService.js";

function makeWav({ sampleRate = 48000, channels = 2, seconds = 0.1, frequency = 440 } = {}) {
  const samples = Math.floor(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + samples * channels * 2);
  buffer.write("RIFF", 0, "latin1");
  buffer.writeUInt32LE(36 + samples * channels * 2, 4);
  buffer.write("WAVE", 8, "latin1");
  buffer.write("fmt ", 12, "latin1");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "latin1");
  buffer.writeUInt32LE(samples * channels * 2, 40);
  let offset = 44;
  for (let i = 0; i < samples; i += 1) {
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.5;
    for (let ch = 0; ch < channels; ch += 1) {
      const s = Math.max(-1, Math.min(1, value));
      buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, offset);
      offset += 2;
    }
  }
  return buffer;
}

function run() {
  // 1. 立体声 48k WAV → 单声道解析
  const wav48 = makeWav({ sampleRate: 48000, channels: 2 });
  const parsed = parsePcmWav(wav48);
  assert.equal(parsed.sampleRate, 48000);
  assert.ok(parsed.samples.length > 0);
  assert.ok(parsed.samples.every((v) => Number.isFinite(v) && Math.abs(v) <= 1), "samples must be normalized");

  // 2. 重采样 48k → 16k
  const resampled = resampleLinear(parsed.samples, 48000, 16000);
  const expectedLen = Math.round(parsed.samples.length * (16000 / 48000));
  assert.ok(Math.abs(resampled.length - expectedLen) <= 1, `resample length ${resampled.length} vs ${expectedLen}`);

  // 3. PCM16 编码长度 = 采样数 × 2
  const pcm = encodePcm16(resampled);
  assert.equal(pcm.length, resampled.length * 2);

  // 4. buildWsUrl:compatible-mode URL → api-ws 端点
  assert.equal(
    buildWsUrl("https://dashscope.aliyuncs.com/compatible-mode/v1"),
    "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
  );
  assert.equal(
    buildWsUrl("https://ws-pmdzco2ehgkv56g6.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"),
    "wss://ws-pmdzco2ehgkv56g6.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
  );

  // 5. 句子累积(interim 只更新当前句,句子结束才提交)
  const acc1 = createSentenceAccumulator();
  acc1.push({ text: "我", end_time: null });
  acc1.push({ text: "我是，我", end_time: null });
  acc1.push({ text: "我是550W 离线版本", end_time: null });
  acc1.push({ text: "我是550W 离线版本，系统自检正在进行。", end_time: 4520 });
  assert.equal(acc1.finish(), "我是550W 离线版本，系统自检正在进行。");

  // 多句子:每句结束各提交一次
  const acc2 = createSentenceAccumulator();
  acc2.push({ text: "第一句。", end_time: 1000 });
  acc2.push({ text: "第二句。", end_time: 2000 });
  acc2.push({ text: "第三句", end_time: null });
  assert.equal(acc2.finish(), "第一句。第二句。第三句");

  // 空输入
  const acc3 = createSentenceAccumulator();
  assert.equal(acc3.finish(), "");

  // 6. 坏输入
  assert.throws(() => parsePcmWav(Buffer.alloc(10)), /音频数据不完整/);
  const fakeWav = Buffer.alloc(64, 0);
  fakeWav.write("NOPE", 0, "latin1");
  assert.throws(() => parsePcmWav(fakeWav), /仅支持 WAV/);

  console.log("ALL ASR UNIT TESTS PASSED");
}

run();
