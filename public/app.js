import {
  $,
  escape,
  toast,
  download,
  copy,
  init,
  run,
  busy,
  resultMeta,
  fileText,
} from "./ui.js";
let result = null;
let pending = false;
let importing = false;
let chosen = 0;
const sample = `diff --git a/src/utils.js b/src/utils.js
index 3e3f003..4fb9951 100644
--- a/src/utils.js
+++ b/src/utils.js
@@ -1,2 +1,6 @@
 export const version = '1.0';
 
+export function add(a, b) {
+  return Number(a) + Number(b);
+}
+
diff --git a/tests/utils.test.js b/tests/utils.test.js
new file mode 100644
--- /dev/null
+++ b/tests/utils.test.js
@@ -0,0 +1,4 @@
+import {add} from '../src/utils.js';
+import assert from 'node:assert/strict';
+assert.equal(add(2, 3), 5);
+assert.equal(add('2', '3'), 5);
`;
function lock(on) {
  document
    .querySelectorAll(
      "#diff,#language,#scope,#file,#sample,#generate,#mode,#subject,#body,[data-candidate]",
    )
    .forEach((el) => (el.disabled = on));
}
function message() {
  return (
    $("#subject").value.trim() +
    ($("#body").value.trim() ? "\n\n" + $("#body").value.trim() : "")
  );
}
function validate() {
  const subject = $("#subject").value.trim();
  const length = [...subject].length;
  $("#subject-count").textContent = `${length} / 72`;
  const valid =
    /^(feat|fix|docs|refactor|test|chore|perf|build|ci|style|revert)(?:\([A-Za-z0-9_-]+\))?!?: .+$/u.test(
      subject,
    ) && length <= 72;
  $("#validation").textContent = valid
    ? "格式符合 Conventional Commits；请核对说明与实际改动是否一致。"
    : "标题需为 type(scope): 描述，建议不超过 72 个字符。";
  $("#validation").classList.toggle("danger", !valid);
  return valid;
}
function select(i) {
  chosen = i;
  const c = result.candidates[i];
  $("#subject").value = c.subject;
  $("#body").value = c.body;
  document.querySelectorAll("[data-candidate]").forEach((el, j) => {
    el.classList.toggle("selected", i === j);
    el.setAttribute("aria-pressed", String(i === j));
  });
  validate();
}
function render(r) {
  result = r.data;
  $("#meta").innerHTML = resultMeta(r.meta);
  $("#stats").textContent =
    `${result.stats.files} FILES · +${result.stats.additions} −${result.stats.deletions}`;
  const labels = {
    added: "新增",
    deleted: "删除",
    renamed: "重命名",
    modified: "修改",
    binary: "二进制",
  };
  $("#files").innerHTML = result.files
    .map(
      (f) =>
        `<div class="file-row"><div><strong>${escape(f.path)}</strong><small class="muted">${escape(labels[f.status] || f.status)}${f.oldPath && f.oldPath !== f.path ? " · 原路径 " + escape(f.oldPath) : ""}</small></div><span><b class="addition">+${f.additions}</b> <b class="deletion">−${f.deletions}</b></span></div>`,
    )
    .join("");
  $("#warnings").innerHTML = result.warnings
    .map((w) => "• " + escape(w))
    .join("<br>");
  $("#candidates").innerHTML = result.candidates
    .map(
      (c, i) =>
        `<button class="candidate" data-candidate="${i}"><span class="number">OPTION 0${i + 1}</span><strong>${escape(c.subject)}</strong><span class="muted">${escape(c.why)}</span></button>`,
    )
    .join("");
  $("#editor").hidden = false;
  select(0);
}
$("#sample").onclick = () => {
  $("#diff").value = sample;
  $("#scope").value = "utils";
};
$("#file").onchange = async (e) => {
  if (pending || importing) return;
  importing = true;
  lock(true);
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (!/\.(diff|patch)$/i.test(f.name))
      throw Error("仅支持 .diff 或 .patch 文件");
    const value = await fileText(f, 240000);
    if (value.length > 60000) throw Error("最多 60,000 字符");
    $("#diff").value = value;
  } catch (err) {
    toast(err.message, true);
  } finally {
    importing = false;
    e.target.value = "";
    lock(false);
  }
};
$("#commit-form").onsubmit = async (e) => {
  e.preventDefault();
  if (pending || importing) return;
  pending = true;
  busy($("#generate"), true, "分析变更中…");
  lock(true);
  try {
    render(
      await run({
        diff: $("#diff").value,
        language: $("#language").value,
        scope: $("#scope").value,
      }),
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    pending = false;
    busy($("#generate"), false);
    lock(false);
  }
};
$("#candidates").onclick = (e) => {
  const b = e.target.closest("[data-candidate]");
  if (b && result && !pending) select(Number(b.dataset.candidate));
};
function saveEdit() {
  if (!result) return;
  result.candidates[chosen].subject = $("#subject").value;
  result.candidates[chosen].body = $("#body").value;
  validate();
}
$("#subject").oninput = saveEdit;
$("#body").oninput = saveEdit;
$("#copy").onclick = () => {
  if (result && validate()) copy(message());
  else toast("请先调整标题格式与长度", true);
};
$("#download").onclick = () => {
  if (result && validate()) download("commit-message.txt", message() + "\n");
  else toast("请先调整标题格式与长度", true);
};
$("#export-report").onclick = () => {
  if (!result) return;
  download(
    "change-summary.md",
    `# 代码变更摘要\n\n${result.stats.files} 个文件，+${result.stats.additions} / −${result.stats.deletions} 行\n\n${result.files.map((f) => `- ${f.path} · ${f.status} · +${f.additions} / −${f.deletions}`).join("\n")}\n\n## 当前提交说明\n\n${message()}\n\n## 检查提示\n\n${result.warnings.join("\n")}\n`,
    "text/markdown;charset=utf-8",
  );
};
await init();
