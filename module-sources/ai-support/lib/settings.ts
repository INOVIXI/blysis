import { readSettingValues } from "@/core/sdk/server";
import { SETTING_KEYS, configFrom, type AiSupportConfig } from "./config";

/** The operator's settings as they stand, read once per call. */
export async function readConfig(): Promise<AiSupportConfig> {
    return configFrom(await readSettingValues(Object.values(SETTING_KEYS)));
}
