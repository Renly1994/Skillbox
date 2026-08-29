#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, rename, rm } from "node:fs/promises";
import { homedir, platform, arch, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const VERSION = "0.6.1";
const RELEASE_BASE = `https://github.com/Renly1994/Skillbox/releases/download/desktop-v${VERSION}`;

const TARGETS = {
  "win32-x64": {
    asset: `Skillbox.Setup.${VERSION}.exe`,
    sha256: "8b50f7ce72c4d09cdbab5faedd73e8c9c30fb4afe32f8ad9b4d2fa7d5e5c6aed",
  },
  "darwin-arm64": {
    asset: `Skillbox-${VERSION}-arm64.dmg`,
    sha256: "18ca6b94bab3da33ffeca36a6a83223a2dbdc6d149177c95f06388a7822ce649",
  },
  "darwin-x64": {
    asset: `Skillbox-${VERSION}-x64.dmg`,
    sha256: "692a00fa2294136e9adab04d4049ea05d1591a1f103e63b5bf7467baeb393ba9",
  },
  "linux-x64": {
    asset: `Skillbox-${VERSION}-x86_64.AppImage`,
    sha256: "c9e18a02e0ad30f6c2f0619e7f9c96e92e77abb5c8121744b04ddb4dea881000",
  },
};

function printHelp() {
  console.log(`Skillbox ${VERSION}

用法：
  npx skillbox-app              下载并打开当前平台安装包
  npx skillbox-app download     仅下载到当前目录
  npx skillbox-app --version    显示版本
  npx skillbox-app --help       显示帮助

选项：
  --output <目录>               指定下载目录
  --force                       重新下载安装包`);
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${name} 需要提供目录`);
  }
  return value;
}

async function fileHash(filePath) {
  const hash = createHash("sha256");
  const file = createReadStream(filePath);
  for await (const chunk of file) hash.update(chunk);
  return hash.digest("hex");
}

async function isVerified(filePath, expectedHash) {
  try {
    await access(filePath);
    return (await fileHash(filePath)) === expectedHash;
  } catch {
    return false;
  }
}

async function download(url, destination, expectedHash) {
  const partial = `${destination}.part`;
  await rm(partial, { force: true });

  const response = await fetch(url, {
    headers: { "User-Agent": `skillbox-app/${VERSION}` },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败：HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  const output = createWriteStream(partial);
  const hash = createHash("sha256");
  let received = 0;

  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      received += buffer.length;
      hash.update(buffer);
      if (!output.write(buffer)) await once(output, "drain");

      const current = (received / 1024 / 1024).toFixed(1);
      const progress = total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : " MB";
      process.stdout.write(`\r正在下载：${current}${progress}`);
    }
    output.end();
    await once(output, "finish");
    process.stdout.write("\n");

    if (hash.digest("hex") !== expectedHash) {
      throw new Error("安装包校验失败，请重新下载");
    }

    await rm(destination, { force: true });
    await rename(partial, destination);
  } catch (error) {
    output.destroy();
    await rm(partial, { force: true });
    throw error;
  }
}

function launchInstaller(filePath, currentPlatform) {
  if (currentPlatform === "win32") {
    const result = spawnSync(filePath, [], { stdio: "inherit" });
    if (result.error) throw result.error;
    return;
  }

  if (currentPlatform === "darwin") {
    const result = spawnSync("open", [filePath], { stdio: "inherit" });
    if (result.error || result.status !== 0) throw result.error ?? new Error("无法打开安装包");
    return;
  }

  const child = spawn(filePath, [], { detached: true, stdio: "ignore" });
  child.unref();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }

  const command = args[0]?.startsWith("-") ? "install" : (args[0] ?? "install");
  if (!new Set(["install", "download"]).has(command)) {
    throw new Error(`未知命令：${command}`);
  }

  const currentPlatform = platform();
  const currentArch = arch();
  const target = TARGETS[`${currentPlatform}-${currentArch}`];
  if (!target) {
    throw new Error(`暂不支持当前平台：${currentPlatform}-${currentArch}`);
  }

  const requestedOutput = readOption(args, "--output");
  let outputDir;
  if (requestedOutput) {
    outputDir = resolve(requestedOutput);
  } else if (command === "download") {
    outputDir = process.cwd();
  } else if (currentPlatform === "linux") {
    outputDir = join(homedir(), "Applications");
  } else {
    outputDir = join(tmpdir(), `skillbox-${VERSION}`);
  }

  await mkdir(outputDir, { recursive: true });
  const destination = join(outputDir, currentPlatform === "linux" ? "Skillbox.AppImage" : basename(target.asset));
  const force = args.includes("--force");

  if (force || !(await isVerified(destination, target.sha256))) {
    await download(`${RELEASE_BASE}/${target.asset}`, destination, target.sha256);
  } else {
    console.log("已找到校验通过的安装包，跳过下载。");
  }

  console.log(`安装包：${destination}`);
  if (command === "download") return;

  if (currentPlatform === "linux") await chmod(destination, 0o755);
  console.log(currentPlatform === "linux" ? "正在启动 Skillbox…" : "正在打开安装程序…");
  launchInstaller(destination, currentPlatform);
}

main().catch((error) => {
  console.error(`Skillbox 安装失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
