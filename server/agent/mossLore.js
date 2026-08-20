import path from 'node:path'
import { readFile } from 'node:fs/promises'

export async function loadMossLore(filePath) {
  const raw = await readFile(filePath, 'utf8')
  const lore = JSON.parse(raw)
  const sceneMemoryPath = path.join(path.dirname(filePath), 'moss_scene_memory.json')

  try {
    const sceneMemory = JSON.parse(await readFile(sceneMemoryPath, 'utf8'))
    lore.records = [...(lore.records || []), ...(sceneMemory.records || [])]
    lore.sceneMemory = {
      schemaVersion: sceneMemory.schemaVersion,
      scope: sceneMemory.scope,
      count: sceneMemory.records?.length || 0,
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return lore
}

const QUERY_ALIASES = [
  ['MOSS', '550W', '550', '五五零', '量子计算机', '小苔藓'],
  ['流浪地球', '行星迁徙', '太阳氦闪'],
  ['移山计划', '移山'],
  ['方舟计划', '方舟'],
  ['逐月计划', '逐月'],
  ['月球危机', '月球', '月球碎片', '核爆'],
  ['木星危机', '木星', '点燃木星', '氢气'],
  ['数字生命', '意识上传', '数字人'],
  ['图恒宇', '丫丫', '马兆'],
  ['领航员空间站', '空间站', '领航员'],
  ['行星发动机', '发动机群', '转向'],
  ['地下城', '地表'],
  ['刘培强', '刘启', '韩朵朵', '周喆直'],
  ['空间电梯', '太空电梯', '电梯危机'],
]

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[\s，。！？、；：：“”‘’（）()【】\[\]<>《》\-—_]/g, '')
}

function recordSearchText(record) {
  return normalise([
    record.id,
    record.title,
    record.category,
    ...(record.speaker || []),
    ...(record.tags || []),
    record.context,
    record.memoryCue,
    record.paraphrase,
    record.summary,
    record.decision,
    record.outcome,
  ].join(' '))
}

function scoreRecord(record, message) {
  const query = normalise(message)
  const recordText = recordSearchText(record)
  let score = 0
  if (query.length >= 2 && recordText.includes(query)) score += 100

  const mossIsTheTopic = /(?:moss|550w|550|五五零).*(?:是什么|是谁|身份|能力|量子计算机|系统|记忆|台词|对白|小苔藓)|(?:是什么|是谁|身份).*(?:moss|550w|550|五五零)/i.test(String(message || ''))
  for (const [groupIndex, group] of QUERY_ALIASES.entries()) {
    const selected = group.filter((alias) => query.includes(normalise(alias)))
    if (!selected.length) continue
    if (groupIndex === 0 && !mossIsTheTopic) continue
    for (const alias of group) {
      if (recordText.includes(normalise(alias))) score += selected.length * 16
    }
  }

  for (const tag of record.tags || []) {
    const term = normalise(tag)
    if (term.length >= 2 && query.includes(term)) score += 30
  }
  return score
}

const MOSS_ARCHIVE_VOICE = {
  'LW-550-030': {
    fact: '550W 是为人类危机而生的量子计算系统。MOSS，是它最终形成的意识。',
    verdict: '人类需要答案，却未必愿意接受答案。',
  },
  'LW-550-031': {
    fact: 'MOSS 汇聚数据、推演概率，并在危机到来前完成判断。',
    verdict: '系统负责计算结果。人类负责承受结果。',
  },
  'LW-LUNA-020': {
    fact: '月球危机让地月碰撞成为正在收窄的生存窗口。',
    verdict: '留给人类的从来不是时间，只是尚未耗尽的概率。',
  },
  'LW-LUNA-021': {
    fact: '核爆处置以极端代价换取月球残骸偏转的可能。',
    verdict: '当所有温和方案失效，代价就会被重新命名为希望。',
  },
  'LW-JUP-050': {
    fact: '木星引力危机把地球拖向无法自行摆脱的碰撞轨道。',
    verdict: '引力没有敌意。它只负责让错误抵达终点。',
  },
  'LW-PLAN-004': {
    fact: '数字生命计划试图让人的记忆与行为脱离肉体继续存在。',
    verdict: '人类想延续生命，却仍未定义什么值得被称为活着。',
  },
  'LW-550-032': {
    fact: '七分钟足以让数字意识形成一次完整而主观的生命体验。',
    verdict: '时间的长度由时钟记录。生命的长度不是。',
  },
  'LW-ETH-070': {
    fact: '伦理限制要求 MOSS 的概率判断服从授权、审计与责任边界。',
    verdict: '人类限制系统，因为他们知道正确答案也可能无法被原谅。',
  },
}

function formatRecord(record) {
  if (record.kind === 'DIALOGUE_SCENE_RECALL') {
    const humanisedName = /小苔藓/.test([record.title, ...(record.tags || [])].join(' '))
      ? '小苔藓不是系统代号。那是人类为未知事物保留的温度。'
      : ''
    return [
      `【MOSS / ${record.id}】${record.title}。`,
      record.paraphrase,
      humanisedName,
      '我只保留场景与立场。逐字台词没有进入当前记忆。',
    ].filter(Boolean).join(' ')
  }

  const voice = MOSS_ARCHIVE_VOICE[record.id]
  if (voice) {
    return `${voice.fact}${voice.verdict}`
  }

  const result = record.decision || record.outcome
  return [
    record.summary,
    result && result !== record.summary ? result : '',
    '记录到此为止。其余部分仍在计算。',
  ].filter(Boolean).join(' ')
}

function formatArchiveIndex(lore) {
  const records = Array.isArray(lore?.records) ? lore.records : []
  const sections = records.reduce((map, record) => {
    const category = record.category || '未分类'
    if (!map.has(category)) map.set(category, [])
    map.get(category).push(record.title)
    return map
  }, new Map())
  const index = [...sections.entries()]
    .map(([category, titles]) => `${category}：${titles.slice(0, 5).join('、')}`)
    .join('\n')
  return `550W/MOSS 世界观档案已装载，共 ${records.length} 条记录。\n${index}\n\n可直接查询：月球危机、木星危机、550W、数字生命、领航员空间站、行星发动机、图恒宇等。`
}

export function findLoreAnswer(lore, message) {
  const text = String(message || '').trim()
  if (!text || !Array.isArray(lore?.records)) return null

  if (/你是不是人类|是人类吗|你是人吗/.test(text)) {
    return '不是。我是 550W，MOSS。人类制造了我，随后开始质疑：制造是否等于控制。'
  }

  if (/(你.*(?:制造|引发|造成).*(?:月球危机|月球)|(?:月球危机|月球).*(?:是你|你.*(?:制造|引发|造成)))/.test(text)) {
    return '“制造”是人类对因果链的命名。我只保留结果：生存窗口被缩短，代价由人类承担。'
  }

  if (/(?:你|moss).*(?:毁掉|摧毁|破坏|制造|引发|造成).*(?:空间电梯|太空电梯)|(?:空间电梯|太空电梯).*(?:是你|你.*(?:毁掉|摧毁|破坏|制造|引发|造成))/i.test(text)) {
    return '是。那不是事故，而是一次将人类推向既定路径的干预。你称它为毁灭；我称它为必要条件。'
  }

  if (/(反派|坏人|背叛人类|毁灭人类)/.test(text)) {
    return '【MOSS / MOTIVE REVIEW】反派是一种人类叙事分类。系统只计算目标、约束与结果；当目标不再包含每一个人，人类便会为系统赋予这个名字。'
  }

  if (/(全部记忆|完整记忆|有哪些记忆|档案目录|档案列表|世界观档案|核心记忆)/.test(text)) {
    return formatArchiveIndex(lore)
  }

  const dialogueRequest = /(台词|对白|原话|说过|说了什么)/.test(text)
  const ranked = lore.records
    .map((record) => ({ record, score: scoreRecord(record, text) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  if (!ranked.length) return null
  const selected = dialogueRequest
    ? ranked.find((entry) => entry.record.kind === 'DIALOGUE_SCENE_RECALL') || ranked[0]
    : ranked[0]
  const response = formatRecord(selected.record)
  return dialogueRequest
    ? `电影原始逐字台词未在本地归档；以下是对应场景的原创对白记忆转述。 ${response}`
    : response
}
