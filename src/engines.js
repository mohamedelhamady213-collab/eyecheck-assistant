// Thin wrappers over the Firebase AI Logic models. Everything is injected so tests can swap them.
export function createEngines(m) {
  const textOf = (r) => r.response.text();
  return {
    nanoState: () => m.nanoAvailability(),
    async runDevice(parts, onProgress) {
      if (m.deviceOnlyModel.initializeDeviceModel) await m.deviceOnlyModel.initializeDeviceModel((p) => onProgress && onProgress(p));
      return textOf(await m.deviceOnlyModel.generateContent(parts));
    },
    async runCloud(parts) {
      try { return { text: textOf(await m.cloudModel.generateContent(parts)), model: m.CLOUD_MODEL }; }
      catch (e) { console.warn("Primary cloud model failed, trying lite", e); return { text: textOf(await m.cloudModelLite.generateContent(parts)), model: m.CLOUD_LITE }; }
    },
    async runCloudText(prompt) { return (await this.runCloud([prompt])); },
  };
}
