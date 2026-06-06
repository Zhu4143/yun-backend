import { promises as fs } from "node:fs";
import path from "node:path";

const MUSIC_DIR = "C:\\Users\\zhudo\\Music\\音乐";

const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg"]);
const VERSION_WORDS = ["Live", "破碎版", "完整版", "Demo", "伴奏", "翻唱"];
const FORMAT_PRIORITY = new Map([
  [".flac", 60],
  [".wav", 50],
  [".m4a", 40],
  [".aac", 30],
  [".ogg", 20],
  [".mp3", 10],
]);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const musicDir = path.resolve(MUSIC_DIR);
const duplicatesDir = path.join(musicDir, "duplicates");
const reportTxtPath = path.join(musicDir, "report.txt");
const reportJsonPath = path.join(musicDir, "report.json");

const plannedTargets = new Set();
const plan = {
  dryRun,
  musicDir,
  duplicatesDir,
  kept: [],
  moved: [],
  renamed: [],
  needsReview: [],
};

function normalizeForKey(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseName(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stem = path.basename(filePath, path.extname(filePath));
  const suffixMatch = stem.match(/\s*\(([1-3])\)\s*$/);
  const canonicalStem = suffixMatch ? stem.slice(0, suffixMatch.index).trim() : stem.trim();
  const versionRegex = new RegExp(VERSION_WORDS.map(escapeRegExp).join("|"), "i");

  return {
    ext,
    stem,
    canonicalStem,
    numericSuffix: suffixMatch ? Number(suffixMatch[1]) : null,
    isNumberedCopy: Boolean(suffixMatch),
    hasVersionWord: versionRegex.test(canonicalStem),
    key: normalizeForKey(canonicalStem),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function scanAudioFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path.resolve(fullPath).toLowerCase() === duplicatesDir.toLowerCase()) continue;
      files.push(...await scanAudioFiles(fullPath));
      continue;
    }

    if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const parsed = parseName(fullPath);
      files.push({
        path: fullPath,
        relativePath: path.relative(musicDir, fullPath),
        ...parsed,
      });
    }
  }

  return files;
}

async function uniqueDuplicateTarget(sourcePath) {
  const parsed = path.parse(sourcePath);
  let candidate = path.join(duplicatesDir, parsed.base);
  let index = 2;

  while (plannedTargets.has(candidate.toLowerCase()) || await fileExists(candidate)) {
    candidate = path.join(duplicatesDir, `${parsed.name}__dup${index}${parsed.ext}`);
    index += 1;
  }

  plannedTargets.add(candidate.toLowerCase());
  return candidate;
}

function markKept(file, reason, finalPath = file.path) {
  if (plan.kept.some(item => item.sourcePath === file.path)) return;
  plan.kept.push({
    sourcePath: file.path,
    finalPath,
    reason,
  });
}

async function markMoved(file, reason) {
  if (plan.moved.some(item => item.from === file.path)) return;
  const to = await uniqueDuplicateTarget(file.path);
  plan.moved.push({
    from: file.path,
    to,
    reason,
  });
}

async function markRenamed(file, to, reason) {
  plan.renamed.push({
    from: file.path,
    to,
    reason,
  });
}

function addReview(fileOrGroup, reason, extra = {}) {
  plan.needsReview.push({
    path: typeof fileOrGroup === "string" ? fileOrGroup : fileOrGroup.path,
    reason,
    ...extra,
  });
}

async function buildPlan(files) {
  const groups = new Map();

  for (const file of files) {
    if (!groups.has(file.key)) groups.set(file.key, []);
    groups.get(file.key).push(file);
  }

  for (const [key, group] of groups) {
    const extGroups = new Map();
    const hasVersionWord = group.some(file => file.hasVersionWord);
    const extKeepers = [];
    const groupLabel = group[0]?.canonicalStem || key;

    for (const file of group) {
      if (!extGroups.has(file.ext)) extGroups.set(file.ext, []);
      extGroups.get(file.ext).push(file);
    }

    for (const [ext, sameExtFiles] of extGroups) {
      const cleanFiles = sameExtFiles
        .filter(file => !file.isNumberedCopy)
        .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
      const numberedFiles = sameExtFiles
        .filter(file => file.isNumberedCopy)
        .sort((a, b) => (a.numericSuffix - b.numericSuffix) || a.path.localeCompare(b.path, "zh-Hans-CN"));

      if (cleanFiles.length > 1) {
        addReview(cleanFiles[0], "同名同格式存在多个未编号文件，需要人工确认", {
          candidates: cleanFiles.map(file => file.path),
        });
      }

      let keeper = cleanFiles[0] || numberedFiles[0] || null;
      let plannedRenameTo = null;

      if (!keeper) continue;

      if (cleanFiles.length) {
        for (const duplicate of numberedFiles) {
          await markMoved(duplicate, `已有未编号版本，移动末尾编号副本 (${duplicate.numericSuffix})`);
        }
      } else if (numberedFiles.length) {
        plannedRenameTo = path.join(path.dirname(keeper.path), `${keeper.canonicalStem}${ext}`);
        const targetExists = await fileExists(plannedRenameTo);
        if (targetExists && plannedRenameTo.toLowerCase() !== keeper.path.toLowerCase()) {
          addReview(keeper, "只有编号文件，但去掉编号后的目标文件名已存在，未自动重命名", {
            target: plannedRenameTo,
          });
          plannedRenameTo = null;
        }

        for (const duplicate of numberedFiles.slice(1)) {
          await markMoved(duplicate, `同格式有多个编号副本，保留编号最小的版本，移动 (${duplicate.numericSuffix})`);
        }
      }

      extKeepers.push({
        file: keeper,
        ext,
        plannedRenameTo,
      });
    }

    if (!hasVersionWord && extKeepers.length > 1) {
      extKeepers.sort((a, b) => {
        const priorityDiff = (FORMAT_PRIORITY.get(b.ext) || 0) - (FORMAT_PRIORITY.get(a.ext) || 0);
        if (priorityDiff) return priorityDiff;
        return a.file.path.localeCompare(b.file.path, "zh-Hans-CN");
      });

      const best = extKeepers[0];
      const sameBest = extKeepers.filter(item => FORMAT_PRIORITY.get(item.ext) === FORMAT_PRIORITY.get(best.ext));
      if (sameBest.length > 1) {
        addReview(group[0], "同一首歌存在多个同优先级格式，需要人工确认", {
          song: groupLabel,
          candidates: sameBest.map(item => item.file.path),
        });
      }

      for (const item of extKeepers.slice(1)) {
        await markMoved(item.file, `同一首歌存在更高优先级格式 ${best.ext}，移动 ${item.ext}`);
      }

      if (best.plannedRenameTo) {
        await markRenamed(best.file, best.plannedRenameTo, "只有编号文件，保留最高优先级格式并去掉末尾编号");
        markKept(best.file, `保留最高优先级格式 ${best.ext}`, best.plannedRenameTo);
      } else {
        markKept(best.file, `保留最高优先级格式 ${best.ext}`);
      }
    } else {
      for (const item of extKeepers) {
        if (item.plannedRenameTo) {
          await markRenamed(item.file, item.plannedRenameTo, "只有编号文件，去掉末尾无意义编号");
          markKept(item.file, "去掉编号后保留", item.plannedRenameTo);
        } else {
          markKept(item.file, hasVersionWord ? "包含版本信息，按独立版本保留" : "保留未编号版本");
        }
      }
    }
  }
}

async function applyPlan() {
  if (dryRun) return;

  await fs.mkdir(duplicatesDir, { recursive: true });

  for (const item of plan.moved) {
    await fs.rename(item.from, item.to);
  }

  for (const item of plan.renamed) {
    if (item.from.toLowerCase() === item.to.toLowerCase()) continue;
    await fs.rename(item.from, item.to);
  }
}

function buildTextReport() {
  const lines = [];
  lines.push("# Music Dedupe Report");
  lines.push("");
  lines.push(`Mode: ${dryRun ? "DRY RUN - no files moved or renamed" : "APPLIED"}`);
  lines.push(`Music directory: ${musicDir}`);
  lines.push(`Duplicates directory: ${duplicatesDir}`);
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  lines.push(`Kept (${plan.kept.length})`);
  for (const item of plan.kept) {
    lines.push(`- ${item.finalPath}`);
    lines.push(`  Reason: ${item.reason}`);
    if (item.sourcePath !== item.finalPath) lines.push(`  Source: ${item.sourcePath}`);
  }
  lines.push("");

  lines.push(`Moved to duplicates (${plan.moved.length})`);
  for (const item of plan.moved) {
    lines.push(`- ${item.from}`);
    lines.push(`  -> ${item.to}`);
    lines.push(`  Reason: ${item.reason}`);
  }
  lines.push("");

  lines.push(`Renamed (${plan.renamed.length})`);
  for (const item of plan.renamed) {
    lines.push(`- ${item.from}`);
    lines.push(`  -> ${item.to}`);
    lines.push(`  Reason: ${item.reason}`);
  }
  lines.push("");

  lines.push(`Needs manual review (${plan.needsReview.length})`);
  for (const item of plan.needsReview) {
    lines.push(`- ${item.path}`);
    lines.push(`  Reason: ${item.reason}`);
    if (item.target) lines.push(`  Target: ${item.target}`);
    if (item.candidates) {
      for (const candidate of item.candidates) lines.push(`  Candidate: ${candidate}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

async function writeReports() {
  const text = buildTextReport();
  await fs.writeFile(reportTxtPath, text, "utf8");
  await fs.writeFile(reportJsonPath, JSON.stringify(plan, null, 2), "utf8");
}

async function main() {
  if (!await fileExists(musicDir)) {
    throw new Error(`MUSIC_DIR 不存在：${musicDir}`);
  }

  if (isInside(reportTxtPath, duplicatesDir) || isInside(reportJsonPath, duplicatesDir)) {
    throw new Error("报告路径不能位于 duplicates 文件夹内");
  }

  const files = await scanAudioFiles(musicDir);
  await buildPlan(files);
  await applyPlan();
  await writeReports();

  console.log(dryRun ? "预览完成，没有移动或重命名音乐文件。" : "去重完成，重复文件已移动到 duplicates。");
  console.log(`扫描音频文件：${files.length}`);
  console.log(`保留：${plan.kept.length}`);
  console.log(`移动到 duplicates：${plan.moved.length}`);
  console.log(`重命名：${plan.renamed.length}`);
  console.log(`需要人工检查：${plan.needsReview.length}`);
  console.log(`报告：${reportTxtPath}`);
  console.log(`报告：${reportJsonPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
