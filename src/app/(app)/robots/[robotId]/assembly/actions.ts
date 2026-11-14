"use server";

import { revalidatePath } from "next/cache";
import { deleteStep, nameSub, reorderSteps, saveStep, StepError, tickStep, type StepInput } from "@/lib/assembly/steps";
import { requireCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";

// The Assembly page (plan/assembly-guides.md): CAD writes steps (instruct), any member with a team
// ticks them (work). src/lib/assembly/steps.ts checks the rest.
export type StepResult = { error?: string; id?: string };

async function run(robotId: string, fn: () => Promise<{ id?: string } | void>): Promise<StepResult> {
  if (!isUuid(robotId)) return { error: "Unknown robot." };
  try {
    const r = await fn();
    revalidatePath(`/robots/${robotId}/assembly`);
    return { id: r?.id };
  } catch (err) {
    if (err instanceof StepError) return { error: err.message };
    if (err instanceof Error && err.message.startsWith("Only ")) return { error: err.message };
    if (err instanceof Error && err.message.startsWith("Ask an admin")) return { error: err.message };
    throw err;
  }
}

export async function saveAssemblyStep(robotId: string, input: StepInput): Promise<StepResult> {
  return run(robotId, async () => {
    const member = await requireCapability("instruct");
    if (!isUuid(input?.systemId) || (input.id && !isUuid(input.id)) || (input.before && !isUuid(input.before))) throw new StepError("Unknown step.");
    return saveStep(robotId, member.id, input);
  });
}

export async function reorderAssemblySteps(robotId: string, systemId: string, subCode: string | null, ids: string[]): Promise<StepResult> {
  return run(robotId, async () => {
    await requireCapability("instruct");
    if (!isUuid(systemId) || !Array.isArray(ids) || !ids.every(isUuid)) throw new StepError("Unknown step.");
    await reorderSteps(robotId, systemId, subCode, ids);
  });
}

export async function deleteAssemblyStep(robotId: string, id: string): Promise<StepResult> {
  return run(robotId, async () => {
    await requireCapability("instruct");
    if (!isUuid(id)) throw new StepError("Unknown step.");
    await deleteStep(robotId, id);
  });
}

export async function nameAssemblySub(robotId: string, systemId: string, code: string, name: string): Promise<StepResult> {
  return run(robotId, async () => {
    await requireCapability("instruct");
    if (!isUuid(systemId) || typeof name !== "string") throw new StepError("Unknown sub-assembly.");
    await nameSub(robotId, systemId, code, name);
  });
}

export async function tickAssemblyStep(robotId: string, id: string, done: boolean): Promise<StepResult> {
  return run(robotId, async () => {
    const member = await requireCapability("work");
    if (!isUuid(id)) throw new StepError("Unknown step.");
    await tickStep(robotId, member.id, id, !!done);
  });
}
