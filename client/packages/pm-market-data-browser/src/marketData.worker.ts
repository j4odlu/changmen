import { startPmBookWorker, type BookWorkerScope } from "./workerRuntime";

/** [changmen 扩展] Public book only; diagnostic hosts compose their own consumer. */
startPmBookWorker(globalThis as unknown as BookWorkerScope);
