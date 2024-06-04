export class Storage {
  private memory = new Map();
  async put(key, value) {
    this.memory.set(key, value);
  }
  async get(key) {
    return this.memory.get(key);
  }
  async delete(key) {
    this.memory.delete(key);
  }
  async list() {
    return this.memory;
  }
}
