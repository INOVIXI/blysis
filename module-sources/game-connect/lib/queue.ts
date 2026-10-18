/**
 * The delivery queue: what waits, who holds it, and how it ends.
 *
 * A job moves PENDING -> CLAIMED -> DONE or FAILED. Every move is a
 * conditional write on the state it leaves, so two servers, two polls or a
 * poll and an admin can race and only one of them changes anything. A lease
 * that runs out leaves NEEDS_REVIEW, and nothing here ever hands such a job
 * out again: the command may have run, and running it twice is the outcome
 * this module exists to prevent.
 */
import type { GameConnectJob, Prisma } from "@prisma/client";
import { prisma } from "@/core/sdk/server";
import { wake } from "./wake";

export type JobState = "PENDING" | "CLAIMED" | "DONE" | "FAILED" | "NEEDS_REVIEW" | "CANCELLED";
export type ReferenceKind = "order" | "chest" | "gift" | "manual";
export type Outcome = "done" | "failed" | "deferred" | "unknown";

export interface DeliveryRequest {
    command: string;
    /** The server to run on, or null when the target is the player's current server. */
    gameServerId: string | null;
    targetCurrent: boolean;
    whenOnline: boolean;
    player: { name: string; id: string | null; userId: string | null };
    groupKey: string;
    sequence: number;
    reference: { kind: ReferenceKind; id: string | null; label: string | null };
}

export interface ProtocolJob {
    id: string;
    groupKey: string;
    sequence: number;
    command: string;
    player: { id: string | null; name: string };
    whenOnline: boolean;
    reference: { kind: string; id: string | null; label: string | null };
}

export interface ReportResult {
    id: string;
    outcome: Outcome;
    detail: string | null;
}

/** The server asking, as far as the queue cares. */
export interface QueueServer {
    gameServerId: string;
    instance: string;
}

export interface OnlinePlayers {
    ids: Set<string>;
    names: Map<string, string | null>;
}

interface HistoryEntry {
    at: string;
    state: JobState;
    by?: string | null;
    detail?: string | null;
}

/** How many jobs one poll may take, so a backlog arrives in pieces. */
const CLAIM_BATCH = 100;

/**
 * How old an unreported claim must be before it is offered again.
 *
 * An answer can be lost on the way back: the site claimed the jobs, the
 * connection dropped, and the server never saw them. Offering them again to
 * the same server, inside their original lease, recovers that without a
 * review, because a client skips every job id its journal already holds.
 */
export const REOFFER_AFTER_MS = 15_000;

function historyOf(job: Pick<GameConnectJob, "history">): HistoryEntry[] {
    return Array.isArray(job.history) ? (job.history as unknown as HistoryEntry[]) : [];
}

function withEntry(job: Pick<GameConnectJob, "history">, entry: HistoryEntry): Prisma.InputJsonValue {
    return [...historyOf(job), entry] as unknown as Prisma.InputJsonValue;
}

export function toProtocolJob(job: GameConnectJob): ProtocolJob {
    return {
        id: job.id,
        groupKey: job.groupKey,
        sequence: job.sequence,
        command: job.command,
        player: { id: job.playerId, name: job.playerName },
        whenOnline: job.whenOnline || job.targetCurrent,
        reference: { kind: job.referenceKind, id: job.referenceId, label: job.referenceLabel },
    };
}

export async function enqueue(request: DeliveryRequest, now: Date = new Date()): Promise<GameConnectJob> {
    const job = await prisma.gameConnectJob.create({
        data: {
            gameServerId: request.targetCurrent ? null : request.gameServerId,
            targetCurrent: request.targetCurrent,
            whenOnline: request.whenOnline || request.targetCurrent,
            command: request.command,
            playerName: request.player.name,
            playerNameLower: request.player.name.toLowerCase(),
            playerId: request.player.id,
            userId: request.player.userId,
            groupKey: request.groupKey,
            sequence: request.sequence,
            referenceKind: request.reference.kind,
            referenceId: request.reference.id,
            referenceLabel: request.reference.label,
            history: [{ at: now.toISOString(), state: "PENDING" }] as unknown as Prisma.InputJsonValue,
        },
    });
    wake(request.targetCurrent ? null : request.gameServerId);
    return job;
}

function playerOnline(job: Pick<GameConnectJob, "playerId" | "playerNameLower">, online: OnlinePlayers): boolean {
    return job.playerId ? online.ids.has(job.playerId) : online.names.has(job.playerNameLower);
}

/** Whether this server may run this job now. */
export function eligible(
    job: Pick<GameConnectJob, "gameServerId" | "targetCurrent" | "whenOnline" | "playerId" | "playerNameLower">,
    gameServerId: string,
    online: OnlinePlayers,
): boolean {
    if (job.targetCurrent) return playerOnline(job, online);
    if (job.gameServerId !== gameServerId) return false;
    return job.whenOnline ? playerOnline(job, online) : true;
}

/**
 * Groups this server may take now, whole and in order.
 *
 * A group is taken only when every pending job in it is eligible. Splitting
 * one would let the second line of a purchase run before the first.
 */
export function eligibleGroups(
    pending: GameConnectJob[],
    gameServerId: string,
    online: OnlinePlayers,
): GameConnectJob[][] {
    const groups = new Map<string, GameConnectJob[]>();
    for (const job of pending) {
        const list = groups.get(job.groupKey);
        if (list) list.push(job);
        else groups.set(job.groupKey, [job]);
    }
    const out: GameConnectJob[][] = [];
    for (const jobs of groups.values()) {
        if (jobs.every((job) => eligible(job, gameServerId, online))) {
            out.push([...jobs].sort((a, b) => a.sequence - b.sequence));
        }
    }
    return out;
}

/** Turns every claim whose lease ran out into a job for review. */
export async function expireLeases(now: Date = new Date()): Promise<number> {
    const expired = await prisma.gameConnectJob.findMany({
        where: { state: "CLAIMED", leaseUntil: { lt: now } },
        take: CLAIM_BATCH,
    });
    let count = 0;
    for (const job of expired) {
        const changed = await prisma.gameConnectJob.updateMany({
            where: { id: job.id, state: "CLAIMED", leaseUntil: { lt: now } },
            data: {
                state: "NEEDS_REVIEW",
                detail: "The server did not answer before its lease ran out.",
                history: withEntry(job, { at: now.toISOString(), state: "NEEDS_REVIEW", by: job.claimedServerId, detail: "lease" }),
            },
        });
        count += changed.count;
    }
    return count;
}

class LostRace extends Error {}

/**
 * Claims what this server may run now. Everything returned is CLAIMED by it.
 */
export async function claimFor(
    server: QueueServer,
    online: OnlinePlayers,
    leaseSeconds: number,
    now: Date = new Date(),
): Promise<ProtocolJob[]> {
    const ids = [...online.ids];
    const names = [...online.names.keys()];
    const candidates = await prisma.gameConnectJob.findMany({
        where: {
            state: "PENDING",
            OR: [
                { gameServerId: server.gameServerId, targetCurrent: false },
                ...(ids.length > 0 ? [{ targetCurrent: true, playerId: { in: ids } }] : []),
                ...(names.length > 0 ? [{ targetCurrent: true, playerId: null, playerNameLower: { in: names } }] : []),
            ],
        },
        orderBy: { createdAt: "asc" },
        take: CLAIM_BATCH,
    });
    if (candidates.length === 0) return (await reoffer(server, now, new Set())).map(toProtocolJob);

    // The rest of each candidate's group, so a group is judged whole.
    const groupKeys = [...new Set(candidates.map((job) => job.groupKey))];
    const pending = await prisma.gameConnectJob.findMany({
        where: { state: "PENDING", groupKey: { in: groupKeys } },
    });

    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const claimed: GameConnectJob[] = [];
    for (const group of eligibleGroups(pending, server.gameServerId, online)) {
        try {
            const taken = await prisma.$transaction(async (tx) => {
                const result = await tx.gameConnectJob.updateMany({
                    where: { id: { in: group.map((job) => job.id) }, state: "PENDING" },
                    data: {
                        state: "CLAIMED",
                        claimedServerId: server.gameServerId,
                        claimedInstance: server.instance,
                        claimedAt: now,
                        leaseUntil,
                    },
                });
                if (result.count !== group.length) throw new LostRace();
                const rows: GameConnectJob[] = [];
                for (const job of group) {
                    // A name-only job is pinned to the id this server sees
                    // under that name, so a later rename cannot lose it.
                    const pin = job.playerId === null ? (online.names.get(job.playerNameLower) ?? null) : null;
                    rows.push(
                        await tx.gameConnectJob.update({
                            where: { id: job.id },
                            data: {
                                ...(pin ? { playerId: pin } : {}),
                                history: withEntry(job, { at: now.toISOString(), state: "CLAIMED", by: server.gameServerId }),
                            },
                        }),
                    );
                }
                return rows;
            });
            claimed.push(...taken);
        } catch (error) {
            if (!(error instanceof LostRace)) throw error;
            // Another server took part of this group first. It is theirs.
        }
    }
    const again = await reoffer(server, now, new Set(claimed.map((job) => job.id)));
    return [...again, ...claimed].map(toProtocolJob);
}

/** This server's claims old enough to have been lost in transit, still inside their lease. */
async function reoffer(server: QueueServer, now: Date, fresh: Set<string>): Promise<GameConnectJob[]> {
    const stale = await prisma.gameConnectJob.findMany({
        where: {
            state: "CLAIMED",
            claimedServerId: server.gameServerId,
            claimedAt: { lt: new Date(now.getTime() - REOFFER_AFTER_MS) },
            leaseUntil: { gt: now },
        },
        orderBy: [{ groupKey: "asc" }, { sequence: "asc" }],
        take: CLAIM_BATCH,
    });
    const offered = stale.filter((job) => !fresh.has(job.id));
    if (offered.length === 0) return [];
    // The claim moves to the asking process and its clock restarts, so the
    // same job is not offered again on the very next poll. The lease does not
    // move: a client that keeps polling and never reports still ends in review.
    await prisma.gameConnectJob.updateMany({
        where: { id: { in: offered.map((job) => job.id) }, state: "CLAIMED", claimedServerId: server.gameServerId },
        data: { claimedInstance: server.instance, claimedAt: now },
    });
    return offered;
}

/**
 * Records what a server says happened. Returns the ids it accepted.
 *
 * `done` and `failed` settle a job this server claimed, even after its lease
 * ran out: the journal on the server is telling the truth, and a job in
 * review is exactly the one whose truth was missing.
 */
export async function report(gameServerId: string, results: ReportResult[], now: Date = new Date()): Promise<string[]> {
    if (results.length === 0) return [];
    const jobs = await prisma.gameConnectJob.findMany({
        where: { id: { in: results.map((r) => r.id) }, claimedServerId: gameServerId },
    });
    const byId = new Map(jobs.map((job) => [job.id, job]));
    const accepted: string[] = [];

    for (const result of results) {
        const job = byId.get(result.id);
        if (!job) continue;
        const detail = result.detail ? result.detail.slice(0, 500) : null;

        if (result.outcome === "done" || result.outcome === "failed") {
            const target: JobState = result.outcome === "done" ? "DONE" : "FAILED";
            if (job.state === target) {
                accepted.push(job.id);
                continue;
            }
            const changed = await prisma.gameConnectJob.updateMany({
                where: { id: job.id, claimedServerId: gameServerId, state: { in: ["CLAIMED", "NEEDS_REVIEW"] } },
                data: {
                    state: target,
                    detail,
                    settledAt: now,
                    leaseUntil: null,
                    history: withEntry(job, { at: now.toISOString(), state: target, by: gameServerId, detail }),
                },
            });
            if (changed.count > 0) accepted.push(job.id);
            continue;
        }

        if (result.outcome === "deferred") {
            const changed = await prisma.gameConnectJob.updateMany({
                where: { id: job.id, claimedServerId: gameServerId, state: "CLAIMED" },
                data: {
                    state: "PENDING",
                    claimedServerId: null,
                    claimedInstance: null,
                    claimedAt: null,
                    leaseUntil: null,
                    history: withEntry(job, { at: now.toISOString(), state: "PENDING", by: gameServerId, detail: "deferred" }),
                },
            });
            if (changed.count > 0) accepted.push(job.id);
            continue;
        }

        // unknown: the command may or may not have run.
        const changed = await prisma.gameConnectJob.updateMany({
            where: { id: job.id, claimedServerId: gameServerId, state: "CLAIMED" },
            data: {
                state: "NEEDS_REVIEW",
                detail: detail ?? "The server could not tell whether the command ran.",
                leaseUntil: null,
                history: withEntry(job, { at: now.toISOString(), state: "NEEDS_REVIEW", by: gameServerId, detail: "unknown" }),
            },
        });
        if (changed.count > 0 || job.state === "NEEDS_REVIEW") accepted.push(job.id);
    }
    return accepted;
}

/** An admin's decision on a job. Each is a conditional write on the state it leaves. */
export async function resolveByAdmin(
    jobId: string,
    action: "mark-done" | "send-again" | "cancel",
    actor: string,
    now: Date = new Date(),
): Promise<boolean> {
    const job = await prisma.gameConnectJob.findUnique({ where: { id: jobId } });
    if (!job) return false;
    const from: JobState[] =
        action === "mark-done" ? ["NEEDS_REVIEW", "FAILED"] : action === "send-again" ? ["NEEDS_REVIEW", "FAILED"] : ["PENDING"];
    const state: JobState = action === "mark-done" ? "DONE" : action === "send-again" ? "PENDING" : "CANCELLED";
    const changed = await prisma.gameConnectJob.updateMany({
        where: { id: jobId, state: { in: from } },
        data: {
            state,
            ...(state === "PENDING"
                ? { claimedServerId: null, claimedInstance: null, claimedAt: null, leaseUntil: null, settledAt: null }
                : { settledAt: now, leaseUntil: null }),
            history: withEntry(job, { at: now.toISOString(), state, by: `admin:${actor}`, detail: action }),
        },
    });
    if (changed.count > 0 && state === "PENDING") wake(job.targetCurrent ? null : job.gameServerId);
    return changed.count > 0;
}
