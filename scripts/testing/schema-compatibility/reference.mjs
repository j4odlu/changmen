import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const reference = JSON.parse(readFileSync(new URL("./reference.json", import.meta.url), "utf8"));
export const checksum = text => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");

/** Load immutable Git blobs, not a moving branch or a copy of the current implementation. */
export function readReference(root) {
  assert.match(reference.commit, /^[0-9a-f]{40}$/);
  return Object.fromEntries(Object.entries(reference.files).map(([file, hash]) => {
    assert(!path.isAbsolute(file) && !file.split("/").includes(".."));
    const source = execFileSync("git", ["show", `${reference.commit}:${file}`], {
      cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(checksum(source), hash, `Old reference changed: ${file}`);
    return [file, source];
  }));
}

export function materializeReference(root, destination) {
  const sources = readReference(root);
  for (const [file, source] of Object.entries(sources)) {
    const target = path.join(destination, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return sources;
}

/** Authored expectations for the synthetic expansion; never recorded from a live catalog. */
export function expandedRequirements(baseline) {
  const expected = structuredClone(baseline);
  Object.assign(expected.schema.tables, {
    round4_schema_probe: { kind: "r", persistence: "p", rowSecurity: false, forceRowSecurity: false },
  });
  Object.assign(expected.schema.columns, {
    "users.round4_optional_note": { type: "text", notNull: false, default: null, identity: "", generated: "" },
    "round4_schema_probe.id": { type: "bigint", notNull: true, default: null, identity: "", generated: "" },
    "round4_schema_probe.note": { type: "text", notNull: false, default: null, identity: "", generated: "" },
  });
  Object.assign(expected.schema.constraints, {
    "round4_schema_probe.round4_schema_probe_pkey": { definition: "PRIMARY KEY (id)", validated: true },
  });
  Object.assign(expected.schema.indexes, {
    "users.round4_users_name_idx": { definition: "CREATE INDEX round4_users_name_idx ON public.users USING btree (user_name)", valid: true, ready: true },
    "round4_schema_probe.round4_schema_probe_pkey": { definition: "CREATE UNIQUE INDEX round4_schema_probe_pkey ON public.round4_schema_probe USING btree (id)", valid: true, ready: true },
  });
  return expected;
}
