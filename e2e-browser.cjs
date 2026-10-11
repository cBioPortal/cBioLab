// The browser every e2e script drives: Playwright from this repo's devDependencies, and Chromium
// from CHROME_PATH when set, else this server's long-standing build when it is present, else the
// browser Playwright downloads itself (`npx playwright install chromium`, as CI does).
const { existsSync } = require("node:fs");
const { chromium } = require("playwright");

const LOCAL_CHROME = (process.env.HOME || "") + "/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome";
const executablePath = process.env.CHROME_PATH || (existsSync(LOCAL_CHROME) ? LOCAL_CHROME : undefined);

/** chromium.launch with the executable chosen above; `opts` are passed through */
const launch = (opts = {}) => chromium.launch({ ...(executablePath ? { executablePath } : {}), ...opts });

module.exports = { chromium, launch };
