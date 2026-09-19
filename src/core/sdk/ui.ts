/**
 * Blysis module SDK - shared UI primitives.
 *
 * Client components. These are the pieces that make a module's screens look
 * like the rest of the admin panel; a module that hand-rolls its own buttons
 * and cards drifts visually the first time core restyles.
 *
 * Deliberately one barrel rather than several: everything here is light. The
 * heaviest, `RichTextEditor`, already loads its editor through `next/dynamic`,
 * so importing `Button` does not drag it in.
 */
export { Button, buttonClassName } from "@/core/components/ui/button";
export { Badge, badgeClassName } from "@/core/components/ui/badge";
/**
 * A Lucide icon named by a string, which is how every module stores one: a
 * forum category, a help category, a nav link. Printed straight the name is
 * what a reader sees - "MessageSquare General" sat in the forum sidebar of
 * every install - and a module hand-rolling its own map covers the six icons
 * its author thought of.
 */
export { NavIcon } from "@/core/components/ui/NavIcon";

/**
 * The other half of that: choosing the name in the first place.
 *
 * A module storing a lucide name had no way to offer one, so the admin side
 * of every icon field was a free text box - and the forum's shipped an emoji
 * as its placeholder, which `NavIcon` renders as nothing at all. A picker and
 * a renderer that agree on what a name is have to be reachable from the same
 * place.
 */
export { IconPicker } from "@/core/components/ui/icon-picker";

/**
 * A member's name and the pill beside it, wearing what their role was given.
 *
 * An operator writes declarations per role; both components check them again
 * at the render site, because a row edited straight in the database has to
 * draw safely too. A module drawing a name out of `role.color` by hand is a
 * screen where the operator's styling silently does nothing, which is what
 * these replaced.
 */
export { RoleName } from "@/core/components/ui/RoleName";
export { RoleBadge } from "@/core/components/ui/RoleBadge";

/**
 * The site's public settings, fetched once per page however many components
 * ask. A module reaching for `/api/v1/public-settings` directly is what this
 * replaces: the allow-list is core's, so the module would be reading a
 * contract it cannot see, and two of them have already shipped code that
 * silently got `undefined` on every load.
 */
export { useSiteSettings } from "@/core/hooks/useSiteSettings";
export type { BadgeTone } from "@/core/components/ui/badge";
export { Card, CardHeader, CardTitle, CardContent } from "@/core/components/ui/card";
export { Checkbox, CheckboxField } from "@/core/components/ui/checkbox";
export type { CheckboxProps, CheckboxFieldProps } from "@/core/components/ui/checkbox";
export { Input } from "@/core/components/ui/input";
export { Label } from "@/core/components/ui/label";
export { Textarea } from "@/core/components/ui/textarea";
export {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from "@/core/components/ui/select";
export { NativeSelect } from "@/core/components/ui/native-select";
export { Pagination, usePagedRows } from "@/core/components/ui/pagination";
export { ListControls } from "@/core/components/ui/list-controls";
export { SegmentedTabs } from "@/core/components/ui/segmented-tabs";
export { ImageLightbox } from "@/core/components/ui/image-lightbox";
export { ModalLayer } from "@/core/components/ui/modal-layer";
export { Radio, RadioField } from "@/core/components/ui/radio";
export { RichContent } from "@/core/components/ui/rich-content";
export type { RadioProps, RadioFieldProps } from "@/core/components/ui/radio";
export type { NativeSelectProps } from "@/core/components/ui/native-select";
export type { PaginationProps } from "@/core/components/ui/pagination";
export type { ListControlsProps, ListFilter, ListSearch } from "@/core/components/ui/list-controls";
export type { SegmentedTab, SegmentedTabsProps } from "@/core/components/ui/segmented-tabs";
export type { ImageLightboxProps } from "@/core/components/ui/image-lightbox";
export { Skeleton } from "@/core/components/ui/skeleton";
export { Waiting } from "@/core/components/ui/waiting";
export { Slider } from "@/core/components/ui/slider";
export type { SliderProps } from "@/core/components/ui/slider";
export { useConfirm } from "@/core/components/ui/confirm-dialog";

/**
 * The site's currency and a formatter for it. A module that shows a price
 * must use this rather than its own `$`: the base comes from the setting the
 * payment gateways charge in, and the formatting follows the reader's locale.
 * A module that knows exchange rates calls `setDisplay({ code, rate })`.
 */
export { useSiteCurrency } from "@/core/components/currency/site-currency";
export type { SiteCurrency, DisplayCurrency } from "@/core/components/currency/site-currency";
export { RichTextEditor } from "@/core/components/ui/rich-text-editor";
// The picker belongs to `UrlOrFile`, not to a screen: a field that can be
// uploaded to can also be linked, and a module reaching for the picker alone
// draws half a field. See `an-image-field-is-one-control`.
export { UrlOrFile } from "@/core/components/ui/url-or-file";

/**
 * A member's face. Exported because every module that lists people drew its
 * own - a letter here, a silhouette there, four sizes - and they disagreed
 * about what to show for the members who have no picture, which is most of
 * them.
 */
/*
 * What a kind of activity is called, and the list of them. A screen that
 * offers these to an operator - a trophy's rule, an activity filter - and a
 * screen that prints one back read the same map.
 */
export { activityKinds, activityTypeLabel } from "@/core/lib/activity-title";
export { MemberAvatar } from "@/core/components/ui/MemberAvatar";
export { MemberLink } from "@/core/components/ui/MemberLink";
export { CountBadge } from "@/core/components/ui/count-badge";
export type { CountBadgeProps } from "@/core/components/ui/count-badge";
export type { MemberLinkProps } from "@/core/components/ui/MemberLink";
export { FooterDropdown } from "@/core/components/ui/footer-dropdown";

// The keyboard half of a dialog: Escape, a Tab trap, and focus handed back to
// whatever opened it. A module that draws its own `role="dialog"` needs this
// as much as core does, and there is one implementation of it.
export { useModalDialog, type ModalDialogOptions } from "@/core/hooks/useModalDialog";

// A create or edit form belongs on an address of its own rather than
// unfolding above the list it belongs to. Core's screens got route
// segments; a module screen gets the same behaviour on the path it has.
export { useFormRoute } from "@/core/hooks/useFormRoute";
export { useRowList, useRowPicks } from "@/core/hooks/useRowList";
export type { RowList, RowListOptions, RowPicks } from "@/core/hooks/useRowList";

// A module that builds a public page needs the same breadcrumb core uses.
// This sat in the tree unreachable from a module, so the store hand-rolled
// its own - and that copy was the one whose crumbs a keyboard could not reach.
export { Breadcrumb } from "@/core/components/ui/breadcrumb";

// A list screen has two ways to be empty: nothing was created yet, or the
// request never came back. Forty screens rendered the same "nothing here yet"
// for both, so a module that fetches its own content needs this panel as much
// as core does.
export { LoadFailed } from "@/core/components/ui/load-failed";

// The browser's `prompt()` renders in the browser's chrome, in the browser's
// language, and some contexts suppress it outright. Two admin screens asked
// for a reason that way. This is the same dialog `useConfirm` opens, with a
// field in it.
export { usePrompt, type PromptOptions } from "@/core/components/ui/confirm-dialog";

// Two formatters bound to the reader's locale. They were core-only, so eleven
// modules reached past the SDK for them and three others fell back to a bare
// `toLocaleDateString()`, which formats in the browser's language whatever the
// site is set to. The boundary check now catches that reach, so these have to
// be here.
export { useLocalDate, useLocalDateTime } from "@/core/hooks/useLocalDate";
export { useRelativeTime } from "@/core/hooks/useRelativeTime";

