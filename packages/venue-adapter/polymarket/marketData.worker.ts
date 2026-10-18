import { startPmBookWorker, type BookWorkerScope } from "@changmen/pm-market-data-browser/workerRuntime";
import { createPmBookDiagnostics } from "../browser/pm-book-diagnostics/workerDiagnostics";

/** [changmen 扩展] Compatibility composition entry; one book and one optional consumer. */
startPmBookWorker(globalThis as unknown as BookWorkerScope, createPmBookDiagnostics);
