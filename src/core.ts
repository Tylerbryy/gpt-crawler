// For more information, see https://crawlee.dev/
import { Configuration, PlaywrightCrawler, downloadListOfUrls } from "crawlee";
import { readFile, writeFile } from "fs/promises";
import { glob } from "glob";
import { Config, configSchema } from "./config.js";
import { Page } from "playwright";
import { isWithinTokenLimit } from "gpt-tokenizer";
import { PathLike } from "fs";

let pageCounter = 0;
let crawler: PlaywrightCrawler;

// Function to get the text content of an element using CSS selector or XPath
export async function getPageContent(page: Page, selector: string): Promise<string> {
  return page.evaluate((selector) => {
    const element = selector.startsWith("/")
      ? document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
      : document.querySelector(selector);
    return element?.textContent || "";
  }, selector);
}

// Function to wait for an element to appear using XPath
export async function waitForElement(page: Page, selector: string, timeout: number): Promise<void> {
  await page.waitForFunction(
    (selector) => {
      return document.evaluate(selector, document, null, XPathResult.BOOLEAN_TYPE, null).booleanValue;
    },
    selector,
    { timeout }
  );
}

export async function crawl(config: Config): Promise<void> {
  configSchema.parse(config);

  if (process.env.NO_CRAWL !== "true") {
    crawler = new PlaywrightCrawler(
      {
        async requestHandler({ request, page, enqueueLinks, log, pushData }) {
          try {
            const title = await page.title();
            pageCounter++;
            log.info(`Crawling: Page ${pageCounter} / ${config.maxPagesToCrawl} - URL: ${request.loadedUrl}...`);

            if (config.selector) {
              await waitForElement(page, config.selector, config.waitForSelectorTimeout ?? 1000);
            }

            const content = await getPageContent(page, config.selector || "body");

            await pushData({ title, url: request.loadedUrl, content });

            if (config.onVisitPage) {
              await config.onVisitPage({ page, pushData });
            }

            await enqueueLinks({
              globs: Array.isArray(config.match) ? config.match : [config.match],
              exclude: Array.isArray(config.exclude) ? config.exclude : config.exclude ? [config.exclude] : [],
            });
          } catch (error: unknown) {
            if (error instanceof Error) {
              if (error.message.includes("net::ERR_SOCKET_NOT_CONNECTED")) {
                log.warning(`Failed to navigate to ${request.loadedUrl} due to network error. Skipping...`);
              } else if (error.message.includes("was not bound in the connection")) {
                log.warning(`Playwright error: ${error.message}. Skipping ${request.loadedUrl}...`);
              } else {
                log.error(`Unexpected error while crawling ${request.loadedUrl}: ${error.message}`);
              }
            } else {
              log.error(`Unknown error while crawling ${request.loadedUrl}: ${error}`);
            }
          }
        },
        maxRequestsPerCrawl: config.maxPagesToCrawl,
        preNavigationHooks: [
          async ({ request, page, log }) => {
            const RESOURCE_EXCLUSIONS = config.resourceExclusions ?? [];
            if (RESOURCE_EXCLUSIONS.length === 0) {
              return;
            }
            if (config.cookie) {
              const cookies = Array.isArray(config.cookie) ? config.cookie : [config.cookie];
              await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, url: request.loadedUrl })));
            }
            await page.route(`**/*.{${RESOURCE_EXCLUSIONS.join(",")}}`, (route) => route.abort());
            log.info("Aborting requests for excluded resources");
          },
        ],
      },
      new Configuration({ purgeOnStart: true })
    );

    const isUrlASitemap = /sitemap.*\.xml$/.test(config.url);

    if (isUrlASitemap) {
      const listOfUrls = await downloadListOfUrls({ url: config.url });
      await crawler.addRequests(listOfUrls);
    } else {
      await crawler.addRequests([config.url]);
    }

    await crawler.run();
  }
}

export async function write(config: Config): Promise<PathLike> {
  const jsonFiles = await glob("storage/datasets/default/*.json", { absolute: true });
  console.log(`Found ${jsonFiles.length} files to combine...`);

  let currentResults: Record<string, any>[] = [];
  let currentSize = 0;
  let fileCounter = 1;
  const maxBytes = config.maxFileSize ? config.maxFileSize * 1024 * 1024 : Infinity;
  let estimatedTokens = 0;

  const nextFileName = (): string => `${config.outputFileName.replace(/\.json$/, "")}-${fileCounter}.json`;

  const writeBatchToFile = async (): Promise<void> => {
    const outputFilePath = nextFileName();
    await writeFile(outputFilePath, JSON.stringify(currentResults, null, 2));
    console.log(`Wrote ${currentResults.length} items to ${outputFilePath}`);
    currentResults = [];
    currentSize = 0;
    fileCounter++;
  };

  const addContentOrSplit = async (data: Record<string, any>): Promise<void> => {
    const contentString = JSON.stringify(data);
    const tokenCount = isWithinTokenLimit(contentString, config.maxTokens || Infinity);

    if (typeof tokenCount === "number") {
      if (estimatedTokens + tokenCount > config.maxTokens!) {
        if (currentResults.length > 0) {
          await writeBatchToFile();
        }
        estimatedTokens = Math.floor(tokenCount / 2);
        currentResults.push(data);
      } else {
        currentResults.push(data);
        estimatedTokens += tokenCount;
      }
    }

    currentSize += Buffer.byteLength(contentString, "utf-8");
    if (currentSize > maxBytes) {
      await writeBatchToFile();
    }
  };

  for (const file of jsonFiles) {
    const fileContent = await readFile(file, "utf-8");
    const data = JSON.parse(fileContent);
    await addContentOrSplit(data);
  }

  if (currentResults.length > 0) {
    await writeBatchToFile();
  }

  return nextFileName();
}

class GPTCrawlerCore {
  constructor(public config: Config) {}

  async crawl(): Promise<void> {
    await crawl(this.config);
  }

  async write(): Promise<PathLike> {
    return write(this.config);
  }
}

export default GPTCrawlerCore;