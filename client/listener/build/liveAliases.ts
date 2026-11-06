import path from "node:path";
import { listenerRoot, repoRoot } from "./paths.mjs";
const source = path.join(listenerRoot, "module");
const replacement = (find: RegExp, file: string) => ({ find, replacement: path.join(source, file) });
export const liveAliases = [
  replacement(/^@\/stores\/matchStore$/, "matchStore.ts"),
  replacement(/^@\/stores\/match\/mainBetLoop$/, "mainBetLoop.ts"),
  replacement(/^@\/stores\/betting\/a8\/runA8ArbRound$/, "arbRound.ts"),
  { find: "@", replacement: path.join(repoRoot, "client/web/src") },
  { find: "@changmen/client-core", replacement: path.join(repoRoot, "client/packages/client-core/src") },
];
