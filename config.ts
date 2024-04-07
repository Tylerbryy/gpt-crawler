import { Config } from "./src/config";

export const defaultConfig: Config = {
  url: "https://hcpcs.codes/",
  match: "https://hcpcs.codes/**",
  maxPagesToCrawl: 999999999999,
  outputFileName: "hcpcs.codes_output1.json",
  maxTokens: 999999999999,
};
