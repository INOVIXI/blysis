import type { ModuleSeed } from "@/core/sdk/seed";
import type { z } from "zod";
import type { formFieldSchema } from "./lib/validations";

/**
 * Two forms a community actually runs, with submissions under them.
 *
 * Between them they use every field type the renderer draws, because a form
 * builder that has only been seen with text inputs is a form builder nobody
 * has checked. The submissions matter as much as the forms: the admin screen
 * is a queue, and an empty queue shows none of what it is for.
 */
/**
 * A seeded question, typed against the module's own list rather than a copy
 * of it. The copy had six types in it while the module offered ten, so a seed
 * that used one of the four newer ones would not compile for a reason that
 * had nothing to do with the seed.
 */
type Field = z.infer<typeof formFieldSchema>;

const FORMS: { slug: string; title: string; description: string; fields: Field[] }[] = [
    {
        slug: "staff-application",
        title: "Apply to be staff",
        description: "Read the requirements first. We answer every application, even the ones we turn down.",
        fields: [
            { name: "name", type: "text", label: "Your in-game name", required: true, placeholder: "Exactly as it appears in chat" },
            { name: "email", type: "email", label: "Email", required: true, placeholder: "So we can reply" },
            { name: "age", type: "number", label: "Age", required: true, min: 13, max: 120 },
            { name: "role", type: "select", label: "Which role", required: true, options: ["Helper", "Moderator", "Builder", "Event host"] },
            { name: "hours", type: "select", label: "Hours a week you can give", required: true, options: ["Under 5", "5 to 10", "10 to 20", "More than 20"] },
            { name: "why", type: "textarea", label: "Why you, and what would you do first", required: true, help: "A paragraph is plenty. What you would do in your first week is the useful part.", maxLength: 2000 },
            // The caption beside the tick, which the public form reads out
            // of `placeholder`. The builder had no box for it, so both forms
            // here shipped a required tick with nothing written next to it.
            { name: "rules", type: "checkbox", label: "The rules", required: true, placeholder: "I have read the rules" },
        ],
    },
    {
        slug: "report-a-bug",
        title: "Report a bug",
        description: "Tell us what you did and what happened instead. Screenshots help more than anything.",
        fields: [
            { name: "name", type: "text", label: "Your in-game name", required: true },
            { name: "where", type: "select", label: "Where did it happen", required: true, options: ["Survival", "Creative", "The lobby", "The website", "Somewhere else"] },
            { name: "what", type: "textarea", label: "What happened", required: true, placeholder: "What you did, then what happened instead of what you expected" },
            { name: "again", type: "checkbox", label: "How often", required: false, placeholder: "It happens every time" },
        ],
    },
];

const APPLICATIONS = [
    { name: "fenrir", email: "fenrir@demo.invalid", age: 19, role: "Moderator", hours: "10 to 20", why: "I am on most evenings and I already answer the same three questions in chat every night.", rules: true },
    { name: "aeryn", email: "aeryn@demo.invalid", age: 24, role: "Builder", hours: "5 to 10", why: "I built the spawn on the old map and I would like to do the next one properly.", rules: true },
    { name: "tomas", email: "tomas@demo.invalid", age: 16, role: "Helper", hours: "Under 5", why: "Happy to do the boring parts nobody else wants.", rules: true },
];

const BUGS = [
    { name: "fenrir", where: "The website", what: "The store page shows my rank as expired but it is not, I bought it yesterday.", again: true },
    { name: "aeryn", where: "Survival", what: "Signs in my shop lose their text after a restart.", again: true },
    { name: "tomas", where: "The lobby", what: "Fell through the floor by the portal once. Could not repeat it.", again: false },
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        let submissions = 0;
        for (const form of FORMS) {
            const existing = await ctx.prisma.customForm.findFirst({ where: { slug: form.slug } });
            if (existing) continue;

            const created = await ctx.create("customForm", () => ctx.prisma.customForm.create({
                data: {
                    slug: form.slug,
                    title: form.title,
                    description: form.description,
                    // A Json column takes Prisma's own input type, and a typed
                    // array of our own shape is not one of them.
                    fields: form.fields as unknown as object[],
                    createdAt: ctx.daysAgo(150),
                },
            }));

            const rows = form.slug === "staff-application" ? APPLICATIONS : BUGS;
            for (const data of rows) {
                // A queue with everything in one state shows nothing of what
                // the status filter is for.
                const status = ctx.pick(["new", "new", "read", "handled"]);
                await ctx.create("customFormSubmission", () => ctx.prisma.customFormSubmission.create({
                    data: {
                        formId: created.id,
                        userId: ctx.pick(ctx.users).id,
                        data,
                        status,
                        createdAt: ctx.daysAgo(60),
                    },
                }));
                submissions += 1;
            }
        }
        ctx.log(`${FORMS.length} forms, ${submissions} submissions`);
    },
};
