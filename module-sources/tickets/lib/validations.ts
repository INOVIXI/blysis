import { z } from "zod";

// ==================== TICKET SCHEMAS ====================

export const ticketDepartmentSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    description: z.string().max(500).optional().nullable(),
    color: z.string().max(32).optional().nullable(),
    order: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
});

/** The PATCH form: every field optional. */
export const ticketDepartmentUpdateSchema = ticketDepartmentSchema.partial();

export const ticketSchema = z.object({
    subject: z.string().min(3, "Subject must be at least 3 characters").max(200),
    departmentId: z.string().min(1, "Department is required"),
    priority: z.string().trim().min(1).max(32).optional(),
    /**
     * Answers to the extra questions this department asks. Bounded here and
     * matched against the questions themselves in lib/fields.ts: which keys
     * are allowed depends on the department, which a schema cannot know.
     */
    fields: z.record(z.string().max(64), z.string().max(2000)).optional(),
    message: z.string().min(10, "Message must be at least 10 characters").max(20_000),
});

export const ticketMessageSchema = z.object({
    content: z.string().min(1, "Message is required").max(20_000),
    ticketId: z.string().min(1),
    attachments: z.array(z.string().url()).optional(),
});

/**
 * A state is a row now, so the schema bounds the shape and the route checks
 * the value against the desk's own list. A `z.enum` here would be the list
 * written down twice, and the second copy is the one that goes stale the
 * first time an operator adds a status.
 */
const stateKey = z.string().trim().min(1).max(32);

export const ticketUpdateSchema = z.object({
    status: stateKey.optional(),
    priority: stateKey.optional(),
    assignedToId: z.string().optional().nullable(),
});

// Type exports
export type TicketInput = z.infer<typeof ticketSchema>;
export type TicketMessageInput = z.infer<typeof ticketMessageSchema>;
