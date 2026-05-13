export class Storage {
  private memory = new Map();
  async put(key, value?) {
    if (typeof key === "string") {
      this.memory.set(key, value);
      return;
    }

    for (const [entryKey, entryValue] of Object.entries(key)) {
      this.memory.set(entryKey, entryValue);
    }
  }
  async get(key) {
    return this.memory.get(key);
  }
  async delete(key) {
    if (Array.isArray(key)) {
      let deleted = 0;
      for (const entryKey of key) {
        if (this.memory.delete(entryKey)) {
          deleted += 1;
        }
      }
      return deleted;
    }
    return this.memory.delete(key);
  }
  async list(options?: { prefix?: string }) {
    if (!options?.prefix) {
      return this.memory;
    }

    return new Map(
      Array.from(this.memory.entries()).filter(([key]) =>
        String(key).startsWith(options.prefix!)
      )
    );
  }
}
