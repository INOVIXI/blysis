import { runAnswerRound } from "../lib/round";

/** Every minute: answer the tickets that are waiting, as lib/round.ts decides. */
export default async function answerWaitingTickets(): Promise<void> {
    await runAnswerRound();
}
