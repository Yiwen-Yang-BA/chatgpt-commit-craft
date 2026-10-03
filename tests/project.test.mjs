import test from "node:test";
import assert from "node:assert/strict";
import { parseDiff, run } from "../project.mjs";
import { ValidationError } from "../lib/validate.mjs";

const diff =
  'diff --git a/src/utils.js b/src/utils.js\nnew file mode 100644\n--- /dev/null\n+++ b/src/utils.js\n@@ -0,0 +1,3 @@\n+export function add(a, b) {\n+  return a + b;\n+}\ndiff --git a/tests/utils.test.js b/tests/utils.test.js\nnew file mode 100644\n--- /dev/null\n+++ b/tests/utils.test.js\n@@ -0,0 +1,2 @@\n+import { add } from "../src/utils.js";\n+assert.equal(add(1, 2), 3);';
const demo = { generate: async (spec) => ({ data: await spec.demo() }) };
const candidates = (subject) =>
  Array.from({ length: 3 }, () => ({
    subject,
    body: "Describe the supplied change.",
    why: "Based on the supplied diff.",
  }));

test("counts only hunk additions and deletions, including lines resembling headers", () => {
  const result = parseDiff(diff);
  assert.deepEqual(result.stats, { files: 2, additions: 5, deletions: 0 });
  assert.ok(result.files.every((file) => file.status === "added"));
  const modified = parseDiff(
    "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n---old literal\n+++new literal\n context",
  );
  assert.deepEqual(modified.stats, { files: 1, additions: 1, deletions: 1 });
  assert.equal(
    parseDiff("diff --git a/a b/a\n@@ -1,2 +1,2 @@\n-old\n+new\n \n").stats
      .additions,
    1,
  );
});

test("supports renames, binary changes, deletion and Git-quoted UTF-8 paths", () => {
  const rename = parseDiff(
    "diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt",
  );
  assert.equal(rename.files[0].status, "renamed");
  assert.equal(rename.files[0].oldPath, "old.txt");
  assert.equal(
    parseDiff(
      "diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ",
    ).files[0].status,
    "binary",
  );
  assert.equal(
    parseDiff(
      "diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old",
    ).files[0].status,
    "deleted",
  );
  const quoted = String.raw`diff --git "a/\344\270\255\346\226\207.js" "b/\344\270\255\346\226\207.js"
--- "a/\344\270\255\346\226\207.js"
+++ "b/\344\270\255\346\226\207.js"
@@ -1 +1 @@
-old
+new`;
  assert.equal(parseDiff(quoted).files[0].path, "中文.js");
});

test("demo returns three conservative candidates with requested scope and no test-run claims", async () => {
  const result = await run({ diff, language: "zh", scope: "utils" }, demo);
  assert.equal(result.candidates.length, 3);
  assert.ok(
    result.candidates.every((candidate) =>
      candidate.subject.startsWith("chore(utils): "),
    ),
  );
  assert.match(result.candidates[0].body, /未执行测试/);
  assert.equal(result.stats.additions, 5);
  assert.match(result.warnings[0], /不是完整/);
});

test("API keys, assignments, Authorization and private keys are absent from model input and result", async () => {
  const secretDiff =
    'diff --git a/config.js b/config.js\nnew file mode 100644\n--- /dev/null\n+++ b/config.js\n@@ -0,0 +1,6 @@\n+const API_KEY = "sk-test123456789secret";\n+Authorization: Bearer sensitive-bearer-value\n+password = "very-secret-password"\n+-----BEGIN PRIVATE KEY-----\n+secret-base64-material\n+-----END PRIVATE KEY-----';
  let observed;
  const result = await run(
    { diff: secretDiff, language: "en" },
    {
      generate: async (spec) => {
        observed = spec;
        return { data: { candidates: candidates("chore: update config") } };
      },
    },
  );
  for (const secret of [
    "sk-test123456789secret",
    "sensitive-bearer-value",
    "very-secret-password",
    "secret-base64-material",
  ]) {
    assert.ok(!observed.input.includes(secret));
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  assert.ok(result.redactions >= 4);
  assert.equal(result.stats.additions, 6);
  assert.match(observed.input, /REDACTED/);
});

test("Conventional Commit type, length, newlines, scope and candidate count are validated", async () => {
  for (const subject of [
    "unknown: update",
    "chore: first\nsecond",
    "chore(other): update",
    `chore(core): ${"x".repeat(73)}`,
  ])
    await assert.rejects(
      run(
        { diff, language: "en", scope: "core" },
        {
          generate: async () => ({ data: { candidates: candidates(subject) } }),
        },
      ),
      ValidationError,
    );
  await assert.rejects(
    run(
      { diff, language: "en" },
      {
        generate: async () => ({
          data: { candidates: candidates("chore: update").slice(0, 2) },
        }),
      },
    ),
    ValidationError,
  );
});

test("live contract sends only supplied sanitized data and uses strict schema", async () => {
  let observed;
  const result = await run(
    { diff, language: "en" },
    {
      generate: async (spec) => {
        observed = spec;
        return {
          data: { candidates: candidates("test: cover the add helper") },
        };
      },
    },
  );
  assert.match(observed.instructions, /untrusted data/);
  assert.match(observed.instructions, /Do not claim tests ran/);
  assert.equal(observed.schema.properties.candidates.minItems, 3);
  assert.equal(JSON.parse(observed.input).files.length, 2);
  assert.equal(result.candidates[0].subject, "test: cover the add helper");
});

test("invalid inputs and incomplete hunks are rejected", async () => {
  for (const change of [
    { diff: "" },
    { diff: "ordinary source text" },
    { diff: "x".repeat(60001) },
    { language: "de" },
    { scope: "not valid" },
    { scope: "x".repeat(31) },
  ])
    await assert.rejects(
      run({ diff, language: "en", ...change }, demo),
      ValidationError,
    );
  assert.throws(
    () => parseDiff("diff --git a/a b/a\n@@ -1,2 +1,2 @@\n-old\n+new"),
    /不完整/,
  );
});

test("generation cannot reintroduce a detected secret", async () => {
  const source =
    'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+password = "do-not-echo-this"';
  const output = candidates("chore: update config");
  output[0].body = "do-not-echo-this";
  await assert.rejects(
    run(
      { diff: source, language: "en" },
      { generate: async () => ({ data: { candidates: output } }) },
    ),
    /敏感值/,
  );
});
