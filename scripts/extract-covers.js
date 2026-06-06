import fs from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseFile } from "music-metadata";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const libraryPath = path.join(rootDir, "server", "data", "musicLibrary.json");
const coversDir = path.join(rootDir, "public", "covers");
const defaultCoverPath = "/covers/default-cover.jpg";
const audioExtensions = new Set([".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg"]);

function readMusicDir() {
  const envPath = path.join(rootDir, ".env");
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, "utf8").match(/^MUSIC_DIR=(.*)$/m);
    if (match?.[1]) return path.resolve(match[1].trim().replace(/^["']|["']$/g, ""));
  }
  return path.resolve("C:\\Users\\zhudo\\Music\\音乐");
}

async function ensureDefaultCover() {
  await mkdir(coversDir, { recursive: true });
  const defaultCoverFile = path.join(coversDir, "default-cover.jpg");
  if (fs.existsSync(defaultCoverFile)) return;
  const defaultCoverBase64 =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QE//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QE//EFBABAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QE//Z";
  await writeFile(defaultCoverFile, Buffer.from(defaultCoverBase64, "base64"));
}

function coverExtensionFromMime(mime = "") {
  const value = String(mime || "").toLowerCase();
  if (value.includes("png")) return ".png";
  if (value.includes("webp")) return ".webp";
  if (value.includes("gif")) return ".gif";
  return ".jpg";
}

async function scanAudioFiles(dir, root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === "duplicates") continue;
      files.push(...await scanAudioFiles(fullPath, root));
      continue;
    }
    if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) {
      const relativePath = path.relative(root, fullPath);
      const id = createHash("sha1").update(relativePath.normalize("NFKC")).digest("hex").slice(0, 16);
      files.push({ id, fullPath });
    }
  }
  return files;
}

async function readMetadata(file) {
  try {
    const metadata = await parseFile(file.fullPath, { duration: false });
    const common = metadata.common || {};
    const picture = Array.isArray(common.picture) ? common.picture[0] : null;
    let coverPath = defaultCoverPath;
    if (picture?.data?.length) {
      const filename = `${file.id}${coverExtensionFromMime(picture.format)}`;
      await writeFile(path.join(coversDir, filename), Buffer.from(picture.data));
      coverPath = `/covers/${filename}`;
    }
    return {
      title: String(common.title || "").trim(),
      artist: String(common.artist || common.artists?.join(", ") || "").trim(),
      album: String(common.album || "").trim(),
      coverPath,
    };
  } catch {
    return { title: "", artist: "", album: "", coverPath: defaultCoverPath };
  }
}

async function main() {
  await ensureDefaultCover();
  const musicDir = readMusicDir();
  const files = await scanAudioFiles(musicDir, musicDir);
  const metadataById = new Map();
  for (const file of files) metadataById.set(file.id, await readMetadata(file));

  const library = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
  let embeddedCovers = 0;
  library.songs = (library.songs || []).map((song) => {
    const metadata = metadataById.get(song.id) || {};
    const next = {
      ...song,
      title: metadata.title || song.title,
      artist: metadata.artist || song.artist,
      album: metadata.album || song.album || "",
      coverPath: metadata.coverPath || song.coverPath || defaultCoverPath,
    };
    if (next.coverPath !== defaultCoverPath) embeddedCovers += 1;
    return next;
  });
  fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), "utf8");
  console.log(JSON.stringify({
    songs: library.songs.length,
    embeddedCovers,
    defaultCovers: library.songs.length - embeddedCovers,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
