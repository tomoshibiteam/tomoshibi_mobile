#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalIndex = line.indexOf("=");
    if (equalIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const separatorIndex = withoutPrefix.indexOf("=");

    if (separatorIndex >= 0) {
      const key = withoutPrefix.slice(0, separatorIndex);
      const value = withoutPrefix.slice(separatorIndex + 1);
      parsed[key] = value;
      continue;
    }

    const key = withoutPrefix;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

function printHelp() {
  const help = `
Usage:
  node scripts/firebase-distribute.js --platform <android|ios> --file <artifact>

Required:
  --platform           android or ios
  --file               path to apk/aab/ipa file

Firebase app id:
  --app-id             override app id directly
  FIREBASE_APP_ID_ANDROID / FIREBASE_APP_ID_IOS can be used by platform

Optional:
  --testers            comma-separated tester emails
  --groups             comma-separated tester group aliases
  --release-notes      release notes text
  --release-notes-file path to release notes file
  --project            firebase project id
  --token              CI token (or use firebase login locally)
  .env/.env.local      loaded automatically if present

Examples:
  npm run firebase:distribute:android -- --file ./build/app-release.apk
  npm run firebase:distribute:ios -- --file ./build/app-release.ipa --groups founders
`;
  process.stdout.write(help);
}

const args = parseArgs(process.argv.slice(2));

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

if (args.help === "true") {
  printHelp();
  process.exit(0);
}

const platform = args.platform;
if (platform !== "android" && platform !== "ios") {
  process.stderr.write(
    "Error: --platform must be either 'android' or 'ios'.\n"
  );
  process.exit(1);
}

const fileArg = args.file;
if (!fileArg) {
  process.stderr.write("Error: --file is required.\n");
  process.exit(1);
}

const artifactPath = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(artifactPath)) {
  process.stderr.write(`Error: artifact not found: ${artifactPath}\n`);
  process.exit(1);
}

const envAppId =
  platform === "android"
    ? process.env.FIREBASE_APP_ID_ANDROID
    : process.env.FIREBASE_APP_ID_IOS;
const appId = args["app-id"] || envAppId;

if (!appId) {
  process.stderr.write(
    `Error: missing Firebase app id. Set --app-id or ${
      platform === "android"
        ? "FIREBASE_APP_ID_ANDROID"
        : "FIREBASE_APP_ID_IOS"
    }.\n`
  );
  process.exit(1);
}

const distributeArgs = [
  "--yes",
  "firebase-tools@latest",
  "appdistribution:distribute",
  artifactPath,
  "--app",
  appId,
];

const testers = args.testers || process.env.FIREBASE_TESTERS;
if (testers) {
  distributeArgs.push("--testers", testers);
}

const groups = args.groups || process.env.FIREBASE_GROUPS;
if (groups) {
  distributeArgs.push("--groups", groups);
}

const releaseNotes = args["release-notes"] || process.env.FIREBASE_RELEASE_NOTES;
if (releaseNotes) {
  distributeArgs.push("--release-notes", releaseNotes);
}

const releaseNotesFile =
  args["release-notes-file"] || process.env.FIREBASE_RELEASE_NOTES_FILE;
if (releaseNotesFile) {
  const releaseFilePath = path.resolve(process.cwd(), releaseNotesFile);
  if (!fs.existsSync(releaseFilePath)) {
    process.stderr.write(
      `Error: release notes file not found: ${releaseFilePath}\n`
    );
    process.exit(1);
  }
  distributeArgs.push("--release-notes-file", releaseFilePath);
}

const project = args.project || process.env.FIREBASE_PROJECT_ID;
if (project) {
  distributeArgs.push("--project", project);
}

const token = args.token || process.env.FIREBASE_TOKEN;
if (token) {
  distributeArgs.push("--token", token);
}

const run = spawnSync("npx", distributeArgs, {
  stdio: "inherit",
  env: process.env,
});

if (run.error) {
  process.stderr.write(`Error: failed to execute npx: ${run.error.message}\n`);
  process.exit(1);
}

process.exit(run.status === null ? 1 : run.status);
