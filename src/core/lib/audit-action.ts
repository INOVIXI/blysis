/**
 * What an entry in the audit log is called.
 *
 * `logActivity` files a row under a machine name - `role.create`,
 * `admin.user.data_exported`, `ticket_status.update` - and the screen printed
 * that name straight out. It is the operator's forensic record, so the key is
 * genuinely useful there and the column is honestly headed "Action key", but
 * a key is still how the code refers to a thing and a person reading a list
 * of eighty of them is reading code. `data_exported` says less than "Exported
 * data" and takes longer to say it.
 *
 * So both: the name a person reads, and the key underneath it, because the
 * screen's own filter takes a key and somebody comparing two installations
 * needs the exact string.
 *
 * Registry-driven for the same reason `activity-title.ts` is. 44 of the
 * 84 actions are a module's, and core must not know a module's name.
 * A module declares its own through `auditActions` in its manifest, the build
 * aggregates them, and the names themselves live in that module's own
 * translations under the `activity` namespace - the block it already writes
 * its activity kinds into.
 *
 * `a-log-entry-says-what-happened.test.ts` holds every `logActivity` call
 * site to having a name here or in a manifest, in both languages.
 */
import { ModuleAuditActions } from "@/core/generated/module-registry";

type Translator = ((key: string) => string) & { has?: (key: string) => boolean };

/**
 * Core's own actions. A module's are merged in below.
 *
 * Written as what happened rather than as what was called: an audit line is
 * read as a sentence about somebody, so it is prose and takes sentence case.
 */
const CORE_AUDIT_NAMES: Record<string, string> = {
    "account.unlocked": "auditAccountUnlocked",
    "admin.impersonate.start": "auditImpersonateStart",
    "admin.impersonate.stop": "auditImpersonateStop",
    "admin.user.data_exported": "auditUserDataExported",
    "admin.user.deleted": "auditUserDeleted",
    "alerting.update": "auditAlertingUpdate",
    "apikey.create": "auditApiKeyCreate",
    "apikey.revoke": "auditApiKeyRevoke",
    "backup.create": "auditBackupCreate",
    "backup.delete": "auditBackupDelete",
    "backup.restore": "auditBackupRestore",
    "broadcast.create": "auditBroadcastCreate",
    "broadcast.send": "auditBroadcastSend",
    "core.update.request": "auditUpdateRequest",
    "ip-block.create": "auditIpBlockCreate",
    "ip-block.delete": "auditIpBlockDelete",
    "moderation.approve": "auditModerationApprove",
    "moderation.reject": "auditModerationReject",
    "module.install": "auditModuleInstall",
    "module.uninstall": "auditModuleUninstall",
    "password.reset": "auditPasswordReset",
    "rate-limits.update": "auditRateLimitsUpdate",
    "role.create": "auditRoleCreate",
    "role.delete": "auditRoleDelete",
    "role.update": "auditRoleUpdate",
    "settings.update": "auditSettingsUpdate",
    "theme.customization.update": "auditThemeCustomizationUpdate",
    "theme.install": "auditThemeInstall",
    "theme.state.update": "auditThemeStateUpdate",
    "translation.edit": "auditTranslationEdit",
    "translation.revert": "auditTranslationRevert",
    "user.account.deleted": "auditOwnAccountDeleted",
    "user.data.exported": "auditOwnDataExported",
    "user.register": "auditUserRegister",
    "user.restriction.lift": "auditRestrictionLift",
    "user.restriction.place": "auditRestrictionPlace",
    "user.role.change": "auditUserRoleChange",
    "warning.delete": "auditWarningDelete",
    "warning.issue": "auditWarningIssue",
    "warning.revoke": "auditWarningRevoke",
};

const NAMES: Record<string, string> = {
    ...CORE_AUDIT_NAMES,
    ...Object.fromEntries(ModuleAuditActions.map((entry) => [entry.action, entry.nameKey])),
};

/**
 * What an action is called, or null.
 *
 * Null rather than the action, because the caller draws the key anyway and a
 * name that is secretly the key twice over is worse than one line. A module
 * somebody wrote themselves has no name here until they declare one, and the
 * key on its own is what that looks like.
 */
export function auditActionName(action: string, t: Translator): string | null {
    const key = NAMES[action] ?? null;
    if (!key) return null;
    if (t.has?.(key) === false) return null;
    return t(key);
}
