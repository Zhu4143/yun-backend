import OpenAI from "openai";

const VISION_SYSTEM_PROMPT = [
  "你是昀的视觉理解模块。",
  "你需要准确理解用户发来的截图、界面、报错、代码或图片内容。",
  "回答要自然、清楚、实用。",
  "不要编造图片里不存在的信息；不确定时直接说明不确定。",
  "如果是 UI 截图、报错截图或代码截图，请尽量指出关键区域、可能原因和下一步建议。",
].join("\n");

export async function analyzeImageWithQwen({ buffer, mimeType, userText }) {
  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error("缺少 DASHSCOPE_API_KEY 环境变量");
  }
  if (!process.env.DASHSCOPE_BASE_URL) {
    throw new Error("缺少 DASHSCOPE_BASE_URL 环境变量");
  }
  if (!buffer?.length) {
    throw new Error("缺少图片内容");
  }

  const client = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: process.env.DASHSCOPE_BASE_URL,
  });
  const safeMime = mimeType || "image/png";
  const base64 = buffer.toString("base64");
  const imageUrl = `data:${safeMime};base64,${base64}`;

  const completion = await client.chat.completions.create({
    model: process.env.VISION_MODEL || "qwen3-vl-plus",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: VISION_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userText || "请理解这张截图，并指出重点。",
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
            },
          },
        ],
      },
    ],
  });

  return {
    answer: completion.choices?.[0]?.message?.content || "",
    usage: completion.usage || null,
  };
}
