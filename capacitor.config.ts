import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.jsemm7963.timering",
  appName: "时间环记",
  webDir: "out",
  backgroundColor: "#f4eee2",
  loggingBehavior: "none",
  android: {
    backgroundColor: "#f4eee2",
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
