import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { assertPresentationSource, assertPresentationBoundaries } from "./presentation-boundary.mjs";
import { presentationTests } from "./presentation-policy.mjs";

afterEach(() => { vi.restoreAllMocks(); });

const valid = `<script setup lang="ts">defineProps<{ text: string; tone?: "positive" | "negative" | null }>();</script>
<template><div class="order__profit-line">{{ text }}<span v-if="text" :class="{pos: tone === 'positive'}"><slot name="amount" /></span></div></template>`;
it("accepts registered passive components and local scoped styles", () => {
  expect(() => assertPresentationBoundaries(process.cwd())).not.toThrow();
  expect(() => assertPresentationSource(valid + '<style scoped>.order__profit-line { gap: 4px; }</style>')).not.toThrow();
});
it.each([
  valid.replace("defineProps", 'import "@/stores/accountStore"; defineProps'),
  valid.replace("defineProps", 'fetch("/api/trade"); defineProps'),
  valid.replace("text: string", "text: () => string"),
  valid.replace("text: string", 'text: import("@/types/order").OrderRow'),
  valid.replace("{{ text }}", '{{ fetch("/api/trade") }}'),
  valid.replace("{{ text }}", '{{ globalThis.localStorage.clear() }}'),
  valid.replace("{{ text }}", '{{ text = "changed" }}'),
  valid.replace("{{ text }}", '{{ text.constructor("return fetch")() }}'),
  valid.replace("{{ text }}", '{{ (() => text)() }}'),
  valid.replace("{{ text }}", '{{ text }}<TradeButton />'),
  valid.replace("<div class", '<div @click="text" class'),
  valid.replace("<div class", '<div v-html="text" class'),
  valid.replace("<div class", '<div v-model="text" class'),
  valid.replace("<div class", '<div :[text]="text" class'),
  valid.replace("<div class", '<div v-bind="text" class'),
  valid.replace("<div class", '<div v-trade="text" class'),
  valid.replace("<template>", '<template src="./logic.html">'),
  valid.replace('<script setup lang="ts">', '<script setup lang="ts" src="./logic.ts">'),
  valid + '<script>import "./logic";</script>',
  valid + '<style>.order__profit-line{color:red}</style>',
  valid + '<style scoped>@import "./external.css";</style>',
  valid + '<style scoped>.order__profit-line{background:url("/request")}</style>',
  valid + '<style scoped>:global(body){display:none}</style>',
  valid + '<style scoped>::v-global(body){display:none}</style>',
  valid + '<style scoped>::v-deep(.trade){display:none}</style>',
  valid + '<style scoped src="./external.css" />',
])("rejects active code or untracked external inputs: %s", source => {
  expect(() => assertPresentationSource(source)).toThrow();
});
it("a missing registered component cannot silently remove the boundary", () => {
  expect(() => assertPresentationBoundaries("missing-fixture-root")).toThrow();
});
it.each(presentationTests)("requires every fixed presentation test through the shared boundary: %s", missing => {
  const exists = fs.existsSync.bind(fs);
  vi.spyOn(fs, "existsSync").mockImplementation(file => String(file).replaceAll("\\", "/").endsWith(missing) ? false : exists(file));
  expect(() => assertPresentationBoundaries(process.cwd())).toThrow(`Required presentation test missing: ${missing}`);
});
it("the planner registry has no dependency on installed packages", () => {
  const source = fs.readFileSync(new URL("./presentation-policy.mjs", import.meta.url), "utf8");
  expect(source).not.toMatch(/\bimport\s*(?:\(|["'{*])/);
});
