/* eslint-disable no-console */
// Workaround to https://github.com/napi-rs/napi-rs/issues/986
import { promises as fs } from "fs";

async function processDefFile() {
  const path = process.argv[process.argv.length-1];

  // Read the whole file in to prevent us writing over ourselves.
  const file = await fs.readFile(path, "utf-8");
  const out = await fs.open(path, 'w');
  for (const line of file.split('\n')) {
    const match = / {2}(\w+\.[\w.-]+):/g.exec(line);
    await out.write((match ? line.replace(match[1], `"${match[1]}"`) : line) + "\n");
  }
  await out.close();
}

processDefFile().catch((ex) => {
    console.error('Failed to process def file!', ex);
    process.exit(1);
})
