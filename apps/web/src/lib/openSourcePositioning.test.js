import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rootReadme = readFileSync(new URL("../../../../README.md", import.meta.url), "utf8");
const gitignore = readFileSync(new URL("../../../../.gitignore", import.meta.url), "utf8");
const marketingHome = readFileSync(new URL("../../../marketing/index.html", import.meta.url), "utf8");

test("Lyfos clearly presents the free version as open source", () => {
  assert.match(rootReadme, /Free Forever/i);
  assert.match(rootReadme, /open source/i);
  assert.match(rootReadme, /Paid Vault/i);
  assert.match(rootReadme, /nuvirolabs-ai\/lyfos-vault/);
});

test("marketing top bar links to the open-source GitHub repo", () => {
  assert.match(marketingHome, /Free open source/);
  assert.match(marketingHome, /github\.com\/nuvirolabs-ai\/lyfos-vault/);
  assert.match(marketingHome, /data-github-stars/);
});

test("generated and local-only artifacts are ignored", () => {
  assert.match(gitignore, /apps\/web\/dist\//);
  assert.match(gitignore, /apps\/mobile\/\.expo\//);
  assert.match(gitignore, /\.claude\//);
  assert.match(gitignore, /supabase\/\.temp\//);
});
