import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve('data');
const filename = path.join(directory, 'bot-credentials-key.env');
await mkdir(directory, { recursive: true, mode: 0o700 });
try {
  await writeFile(filename, `BOT_CREDENTIALS_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Created private configuration: ${filename}`);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log(`Existing key preserved: ${filename}`);
}
