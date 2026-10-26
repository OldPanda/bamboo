import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Vitest emits raw inspector payloads before reporting/cleanup. Preserve those
// exact bytes; NODE_V8_COVERAGE at process exit only sees the CLI after Vitest
// has stopped its inspector and does not preserve the page's counters.
export default class PreserveV8 {
  onInit(ctx) {
    this.enabled = ctx.config.coverage.enabled;
    this.temporary = resolve(ctx.config.coverage.reportsDirectory, ".tmp");
    this.output = resolve(ctx.config.root, "artifacts/coverage/v8-raw");
  }

  onTestRunEnd() {
    if (!this.enabled) return;
    mkdirSync(this.output, { recursive: true });
    let applicationScripts = 0;
    for (const name of readdirSync(this.temporary).filter((n) => n.endsWith(".json"))) {
      const bytes = readFileSync(resolve(this.temporary, name));
      const payload = JSON.parse(bytes);
      applicationScripts += payload.result.filter((s) => s.url.includes("/frontend/src/")).length;
      writeFileSync(resolve(this.output, `${name}.gz`), gzipSync(bytes));
    }
    if (!applicationScripts) throw new Error("Raw V8 evidence contains no application scripts");
  }
}
