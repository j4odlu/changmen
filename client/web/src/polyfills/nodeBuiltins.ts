/** 浏览器侧补齐依赖使用的 Node 全局；buffer / process 仍由 mqtt 等依赖使用。 */
import * as bufferPkg from "buffer";
import * as processPkg from "process";

const BufferImpl = (bufferPkg as { Buffer?: typeof Buffer }).Buffer
  ?? (bufferPkg as { default?: { Buffer?: typeof Buffer } }).default?.Buffer;

const processImpl = (processPkg as { default?: NodeJS.Process }).default
  ?? (processPkg as unknown as NodeJS.Process);

const g = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
  process?: NodeJS.Process;
};

if (BufferImpl && !g.Buffer)
  g.Buffer = BufferImpl;
if (processImpl && !g.process)
  g.process = processImpl;
