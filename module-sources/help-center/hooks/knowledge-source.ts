/**
 * Answers `support.sources`: tells a support assistant's settings screen that
 * help articles can be drawn on, and what to call them. The shapes are stated
 * here for the reason `knowledge.ts` gives.
 */
import { moduleTranslator } from "@/core/sdk/server";
import { SOURCE_ID } from "./knowledge";

interface KnowledgeSource {
    id: string;
    label: string;
}

const articlesSource = async (current: KnowledgeSource[], context: { locale: string }): Promise<KnowledgeSource[]> => {
    const t = await moduleTranslator("helpCenter", context.locale);
    return [...current, { id: SOURCE_ID, label: t("knowledge_articles") }];
};

export default articlesSource;
