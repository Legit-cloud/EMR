"use client";

import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
    afterMovement,
    checkUnits,
    MOVEMENT_LABEL,
    type MovementKind,
    refusalMessage,
    type SupplyItem,
    useMoveStock,
} from "@/lib/inventory";

const FORM_ID = "movement-form";

export type MovementTarget = { item: SupplyItem; kind: MovementKind };

const TITLE: Record<MovementKind, string> = {
    receive: "Receive stock",
    issue: "Issue stock",
    adjust: "Correct the count",
};

/** One dialog for the three ways stock changes. A count correction needs a reason. */
export function MovementDialog({
    target,
    onOpenChange,
}: {
    target: MovementTarget | null;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Modal
            open={target !== null}
            onOpenChange={onOpenChange}
            title={target ? TITLE[target.kind] : ""}
            description={
                target
                    ? `${target.item.name}: ${target.item.on_hand} ${target.item.unit} now`
                    : undefined
            }
            footer={
                <ModalFooter
                    start={
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                    }
                    end={
                        <Button type="submit" form={FORM_ID}>
                            {target ? MOVEMENT_LABEL[target.kind] : "Save"}
                        </Button>
                    }
                />
            }
        >
            {target && (
                <MovementForm
                    key={`${target.item.id}-${target.kind}`}
                    target={target}
                    onDone={() => onOpenChange(false)}
                />
            )}
        </Modal>
    );
}

function MovementForm({ target, onDone }: { target: MovementTarget; onDone: () => void }) {
    const { item, kind } = target;
    const toast = useToast();
    const move = useMoveStock();
    const [units, setUnits] = useState("");
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const checked = checkUnits(units, { min: kind === "adjust" ? 0 : 1 });
    const preview = "units" in checked ? afterMovement(kind, item.on_hand, checked.units) : null;

    async function submit(event: FormEvent) {
        event.preventDefault();
        setProblem(null);
        if ("error" in checked) return setError(checked.error);
        if (kind === "issue" && checked.units > item.on_hand) {
            return setError(`Only ${item.on_hand} ${item.unit} in stock.`);
        }
        if (kind === "adjust" && !reason.trim()) return setError("Say why the count is changing.");
        setError(null);
        try {
            await move.mutateAsync({
                item: item.id,
                kind,
                quantity: checked.units,
                reason: reason.trim(),
            });
            toast({ title: `${MOVEMENT_LABEL[kind]}: ${item.name}`, tone: "success" });
            onDone();
        } catch (failure) {
            setProblem(refusalMessage(failure));
        }
    }

    return (
        <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
            {problem && <Banner tone="danger" live title={problem} />}
            <Input
                label={kind === "adjust" ? "Counted quantity" : "Quantity"}
                inputMode="numeric"
                value={units}
                error={error ?? undefined}
                hint={
                    preview !== null && preview >= 0
                        ? `${preview} ${item.unit} after this`
                        : undefined
                }
                onChange={(e) => {
                    setUnits(e.target.value);
                    setError(null);
                }}
            />
            <Input
                label="Reason"
                optional={kind !== "adjust"}
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
            />
        </form>
    );
}
