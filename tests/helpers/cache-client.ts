import type { CacheClient } from "../../src/utils/cache";

export class FakeCacheClient implements CacheClient {
  isReady = true;
  failGet = false;
  failSet = false;
  failDel = false;
  now = 0;
  writes = 0;
  reads = 0;
  deleted: string[][] = [];
  readonly entries = new Map<string, { value: string; expiresAt: number }>();

  get(key: string): Promise<string | null> {
    this.reads += 1;
    if (this.failGet) throw new Error("private Redis read details");
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt <= this.now) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(
    key: string,
    value: string,
    { expiration }: { expiration: { type: "EX"; value: number } },
  ): Promise<string> {
    if (this.failSet) throw new Error("private Redis write details");
    this.writes += 1;
    this.entries.set(key, {
      value,
      expiresAt: this.now + expiration.value * 1000,
    });
    return Promise.resolve("OK");
  }

  del(keys: string[]): Promise<number> {
    if (this.failDel) throw new Error("private Redis delete details");
    this.deleted.push(keys);
    let count = 0;
    for (const key of keys) if (this.entries.delete(key)) count += 1;
    return Promise.resolve(count);
  }
}
