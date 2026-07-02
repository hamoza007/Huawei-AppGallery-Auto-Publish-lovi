import { resolveAppTemplate } from "../src/lib/app-template";
import { runHuaweiConsoleRequiredFields } from "../src/lib/huawei-console-automation";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

async function main() {
  const appId = readArg("appId") ?? process.env.HUAWEI_CONSOLE_APP_ID;
  if (!appId) {
    throw new Error("Missing app id. Pass --appId=<AGC app id> or set HUAWEI_CONSOLE_APP_ID.");
  }

  const template = await resolveAppTemplate();
  await runHuaweiConsoleRequiredFields({
    appId,
    packageName: readArg("packageName") ?? process.env.HUAWEI_CONSOLE_PACKAGE_NAME,
    versionName: readArg("versionName") ?? process.env.HUAWEI_CONSOLE_VERSION_NAME,
    appUrl: readArg("appUrl"),
    cdpEndpoint: readArg("cdpEndpoint"),
    template,
    onLog: (line) => console.log(`[huawei-console] ${line}`),
  });
}

main().catch((err) => {
  console.error(`[huawei-console] ${(err as Error).message}`);
  process.exit(1);
});
