import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
export function csvRows(source) {
  if (typeof source !== "string" || source.length > 5000000)
    throw new Error("Choose a CSV smaller than 5 MB.");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length)
        throw new Error("Invalid CSV quoting.");
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quote.");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((x) =>
    x
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase(),
  );
  if (!headers.includes("phone") && !headers.includes("number"))
    throw new Error(
      "CSV needs a phone column using international +country-code numbers.",
    );
  return rows.map((values) =>
    Object.fromEntries(
      headers.map((key, i) => {
        let value = values[i] || "";
        if (
          ["phone", "number"].includes(key) &&
          /^'\+[1-9]\d{7,14}$/.test(value)
        )
          value = value.slice(1);
        return [key, value];
      }),
    ),
  );
}
export function csvExport(rows) {
  const headers = [
    "name",
    "phone",
    "company",
    "role",
    "source",
    "notes",
    "stage",
    "consent",
    "active",
  ];
  const cell = (v) => {
    let str = String(v ?? "");
    if (/^[=+@\-\t\r]/.test(str)) str = "'" + str;
    return `"${str.replaceAll('"', '""')}"`;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => cell(row[h])).join(",")),
  ].join("\r\n");
}
export async function legacyRows() {
  const base =
    process.env.BISMYTH_TUI_DATA ||
    join(homedir(), ".local/share/bismyth-lead-tui");
  let names;
  try {
    names = await readdir(join(base, "runs"));
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names.filter((n) => /^[a-f0-9-]+\.json$/.test(n))) {
    const run = JSON.parse(await readFile(join(base, "runs", name), "utf8"));
    for (const project of run.projects || [])
      for (const c of project.contactCapture?.contacts || []) {
        if (c.kind === "phone")
          rows.push({
            phone: c.value,
            name: c.name || c.value,
            company: c.organization || "",
            role: c.role || "",
            source: c.sourceUrl || project.url || "Bismyth Leads saved run",
          });
      }
  }
  return rows;
}

export async function loadSavedDirectory(store, loader=legacyRows) {
  if(store.get("directory_legacy_loaded")) return;
  try {
    const rows=await loader();let added=0,duplicates=0,invalid=0;
    for(let i=0;i<rows.length;i+=10000){const result=store.importContacts(rows.slice(i,i+10000));added+=result.added;duplicates+=result.duplicates;invalid+=result.errors.length;}
    store.set("directory_legacy",{status:"loaded",added,duplicates,invalid});
    store.set("directory_legacy_loaded",true);
  }catch{store.set("directory_legacy",{status:"error",error:"Saved leads could not be loaded. Use Older runs to retry or import a CSV."});}
}
