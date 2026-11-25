// Thin wrappers over the Firebase AI Logic models. Everything is injected so tests can swap them.
export function createEngines(m) {
  const textOf = (r) => r.response.text();
  return {
    nanoState: () => m.nanoAvailability(),
    // Split so the Nano state manager can tell "initialized" apart from "generated".
    async initDevice(onProgress) {
      if (!m.deviceOnlyModel.initializeDeviceModel) return false; // SDK has no explicit init step
      await m.deviceOnlyModel.initializeDeviceModel((p) => onProgress && onProgress(p));
      return true;
    },
    async generateDevice(parts) { return textOf(await m.deviceOnlyModel.generateContent(parts)); },
    async runDevice(parts, onProgress) { await this.initDevice(onProgress); return this.generateDevice(parts); },
    async runCloud(parts) {
      try { return { text: textOf(await m.cloudModel.generateContent(parts)), model: m.CLOUD_MODEL }; }
      catch (e) { console.warn("Primary cloud model failed, trying lite", e); return { text: textOf(await m.cloudModelLite.generateContent(parts)), model: m.CLOUD_LITE }; }
    },
    async runCloudText(prompt) { return (await this.runCloud([prompt])); },
  };
}
