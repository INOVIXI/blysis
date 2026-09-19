/**
 * Blysis module SDK - admin scaffolds.
 *
 * `AdminCrudPage` and `SettingsForm` render a complete list/create/edit screen
 * or a settings panel from a field description, so a module's admin route is
 * usually a manifest entry plus a few lines of configuration.
 *
 * Separate from `@/core/sdk/ui` so a public-facing module page never pulls the
 * admin scaffolds into its bundle.
 */
// The top of an admin screen. Eighty of them had written the title, the
// description and the action button by hand, in twelve heading sizes and
// half a dozen row layouts; a module's screen should look like core's.
export { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
export type { AdminPageHeaderProps } from "@/core/components/admin/AdminPageHeader";

// The strip above a list: how to tick the page, and what can be done to what
// is ticked. A module drawing its own table gets the same two answers in the
// same place as the shell's, rather than a destructive button in the corner.
export { BulkBar } from "@/core/components/admin/BulkBar";
export type { BulkBarProps } from "@/core/components/admin/BulkBar";

// What you can do to one row. A module passes what its rows can do; it does
// not pass a size, a variant or a gap, because those are what drifted.
// A field that names another record. Nothing in the panel shows an id, so a
// box asking for one can only be filled from the database.
export { ReferencePicker } from "@/core/components/admin/ReferencePicker";
export type { ReferencePickerProps } from "@/core/components/admin/ReferencePicker";

export { RowActions } from "@/core/components/admin/RowActions";
export type { RowAction, RowActionsProps } from "@/core/components/admin/RowActions";

export { AdminCrudPage } from "@/core/components/admin/AdminCrudPage";
export type { CrudField } from "@/core/components/admin/AdminCrudPage";
export { SettingsForm } from "@/core/components/admin/SettingsForm";
export type { SettingsField } from "@/core/components/admin/SettingsForm";

// Settings page for a module that contributes a sign-in provider. There is
// nothing to save: Auth.js reads its credentials from the environment at
// startup, so what an admin needs is which variables to set and the redirect
// URL to register - not a form that would appear to work and change nothing.
export { AuthProviderSetup } from "@/core/components/admin/AuthProviderSetup";
export type { AuthProviderSetupProps } from "@/core/components/admin/AuthProviderSetup";

// Reading the site settings, and knowing whether the read worked. A settings
// screen that cannot tell a 500 from an empty answer renders its defaults and
// then writes them back over the settings it never read; see the hook.
export { useSettingsLoad } from "@/core/hooks/useSettingsLoad";
export { readJson, ReadFailed } from "@/core/lib/read-json";

// "Which user?", typed and debounced. A module screen that asks for an
// account had no way to reach this and would write the search a third time.
export { UserPicker } from "@/core/components/admin/UserPicker";
export type { PickedUser } from "@/core/components/admin/UserPicker";
