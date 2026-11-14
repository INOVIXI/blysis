/**
 * Answers `support.sources`: tells a support assistant's settings screen that
 * canned responses can be drawn on, and what to call them. The shapes are
 * stated here for the reason `knowledge.ts` gives.
 */
import { moduleTranslator } from "@/core/sdk/server";
import { SOURCE_ID } from "./knowledge";

interface KnowledgeSource {
    id: string;
    label: string;
}

const cannedSource = async (current: KnowledgeSource[], context: { locale: string }): Promise<KnowledgeSource[]> => {
    const t = await moduleTranslator("tickets", context.locale);
    return [...current, { id: SOURCE_ID, label: t("knowledge_cannedResponses") }];
};

export default cannedSource;
