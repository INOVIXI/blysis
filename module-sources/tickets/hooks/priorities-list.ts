/** Answers `tickets.priorities.list`: the priorities this desk has, named in `locale`. */
import type { HookHandlerFor } from "@/core/sdk";
import { moduleTranslator } from "@/core/sdk/server";
import { readTicketStates } from "../lib/read-states";

const prioritiesList: HookHandlerFor<"tickets.priorities.list", "filter"> = async (_current, { locale }) => {
    const [{ priorities }, t] = await Promise.all([readTicketStates(locale), moduleTranslator("tickets", locale)]);
    // The module's own word where it has one, the operator's where they typed
    // one: `stateLabel` reads them in the same order on the screens.
    return priorities.map((p) => {
        const named = p.nameKey ? t(p.nameKey) : "";
        const label = named && named !== p.nameKey ? named : (p.name ?? p.key.replace(/_/g, " "));
        return { id: p.key, label };
    });
};

export default prioritiesList;
