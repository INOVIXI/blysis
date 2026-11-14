/**
 * The answer's JSON Schema the way `response_format` takes it.
 *
 * Strict mode guarantees the shape, but OpenAI refuses a strict request
 * outright when the schema breaks its rules: every object closed with
 * `additionalProperties: false` and every property required. Core's schema
 * comes from whatever Zod schema a module wrote, so a module with an optional
 * field would get no answer at all. Such a schema is sent as guidance instead,
 * and core's own parse still refuses an answer that does not fit.
 */
export function responseFormat(schema: Record<string, unknown>) {
    const { $schema: _dialect, ...body } = schema;
    return {
        type: "json_schema" as const,
        json_schema: { name: "answer", schema: body, strict: meetsStrictRules(body) },
    };
}

function meetsStrictRules(node: unknown): boolean {
    if (Array.isArray(node)) return node.every(meetsStrictRules);
    if (node === null || typeof node !== "object") return true;
    const schema = node as Record<string, unknown>;
    if (schema.type === "object" || "properties" in schema) {
        const properties = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {});
        const required = Array.isArray(schema.required) ? schema.required : [];
        if (schema.additionalProperties !== false) return false;
        if (!properties.every((name) => required.includes(name))) return false;
    }
    return Object.values(schema).every(meetsStrictRules);
}
