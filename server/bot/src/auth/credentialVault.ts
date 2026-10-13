import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type BinanceCredentials = { apiKey: string; apiSecret: string };

export class CredentialVault {
  private readonly key: Buffer | null;

  constructor(encodedKey = process.env.BOT_CREDENTIALS_ENCRYPTION_KEY ?? "") {
    this.key = /^[a-fA-F0-9]{64}$/.test(encodedKey) ? Buffer.from(encodedKey, "hex") : null;
  }

  get configured(): boolean { return this.key !== null; }

  encrypt(credentials: BinanceCredentials, userId: number, environment: string): string {
    if (!this.key) throw new Error("პირადი გასაღებებისთვის სერვერზე BOT_CREDENTIALS_ENCRYPTION_KEY უნდა დაემატოს");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${userId}:${environment}`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
  }

  decrypt(payload: string, userId: number, environment: string): BinanceCredentials {
    if (!this.key) throw new Error("პირადი გასაღებების დაშიფვრის პარამეტრი არ არის გამართული");
    try {
      const [version, iv, tag, encrypted] = payload.split(".");
      if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid envelope");
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
      decipher.setAAD(Buffer.from(`${userId}:${environment}`));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      const credentials = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8"));
      if (typeof credentials.apiKey !== "string" || typeof credentials.apiSecret !== "string") throw new Error("Invalid credentials");
      return credentials;
    } catch { throw new Error("პირადი გასაღებების წაკითხვა ვერ მოხერხდა; შეამოწმე დაშიფვრის კონფიგურაცია"); }
  }
}
