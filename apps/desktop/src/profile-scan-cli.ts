import { app, net } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

const index = process.argv.indexOf("--data-dir");
if (index === -1 || !process.argv[index + 1]) {
  console.error("Usage: profiles:scan --data-dir <Vaultly user-data directory containing vaultly.db>");
  app.exit(1);
} else {
  const directory = path.resolve(process.argv[index + 1]!);
  if (!existsSync(path.join(directory, "vaultly.db"))) {
    console.error("That directory does not contain vaultly.db. Choose the existing Vaultly user-data directory.");
    app.exit(1);
  }
  process.env.VAULTLY_RUNTIME_DIR = directory;
  app.setPath("userData", directory);
  // Keep the process alive after closing the hidden browser until the final
  // report is flushed and the SQLite connection is closed.
  app.on("window-all-closed", () => undefined);
  void app.whenReady().then(async () => {
    const { createPeopleProfileScanner } = await import("../../api/src/people-profile-scan.js");
    const { createPeopleProfileBrowser } = await import("./people-profile-browser.js");
    const { database } = await import("../../api/src/database.js");
    const scanner = createPeopleProfileScanner({ createBrowser: createPeopleProfileBrowser, fetchProfileImage: (url, options) => net.fetch(url, options) });
    const cancel = () => { void scanner.cancel(); };
    process.on("SIGINT", cancel);
    try {
      let previous = "";
      let report = await scanner.start();
      while (report.status === "running") {
        const label = `${report.processed}/${report.total} checked; ${report.updated} photos saved; ${report.currentName ?? "starting"}`;
        if (label !== previous) { console.log(label); previous = label; }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        report = await scanner.status();
      }
      console.log(JSON.stringify(report, null, 2));
      database.close();
      app.exit(report.status === "failed" ? 1 : 0);
    } catch (error) {
      await scanner.cancel();
      console.error(error instanceof Error ? error.message : error);
      database.close(); app.exit(1);
    }
  });
}
