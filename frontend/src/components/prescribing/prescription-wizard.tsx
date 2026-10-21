"use client";

import { ClipboardText, Lock, Pill, Plus, ShieldCheck, Trash } from "@phosphor-icons/react";
import { useState } from "react";

import { AllergyPills } from "@/components/chart/allergy-pills";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { apiError } from "@/lib/api";
import { useAllergies, usePrescriptions, useRefreshChart } from "@/lib/chart-queries";
import { formatDay, humanise } from "@/lib/format";
import {
  activeMedications,
  blankItem,
  type DraftItem,
  drugLabel,
  FREQUENCIES,
  fromPrescription,
  hasErrors,
  itemErrors,
  OTHER_REASON,
  overrideReason,
  OVERRIDE_REASONS,
  type Prescription,
  ROUTES,
  type SafetyAlert,
  useCancelPrescription,
  useFormulary,
  useSaveAndCheck,
  useSign,
  MIN_OVERRIDE_REASON,
} from "@/lib/prescribing";
import { useDebounced } from "@/lib/use-debounced";

const STEPS = [
  { label: "Medicines", icon: Pill },
  { label: "Review and sign", icon: ClipboardText },
];

const FORM_ID = "prescription-form";

export type PrescriptionStart = {
  /** A draft to carry on with. */
  draft?: Prescription;
  /** A signed prescription to write an amended copy of. */
  amend?: Prescription;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  encounterId: string;
  start?: PrescriptionStart;
};

/**
 * The prescription wizard (docs/DESIGN.md 7): the medicines, then a review beside the patient's
 * allergies and current medicines. The server's safety check runs before signing; a blocking
 * alert keeps Sign disabled until the clinician chooses a reason and confirms the override.
 * A signed prescription is never edited: an amended copy is written instead.
 */
export function PrescriptionWizard(props: Props) {
  // A fresh form each time it opens, so it never keeps the last prescription's details.
  const { start } = props;
  const key = `${start?.draft?.id ?? ""}|${start?.amend?.id ?? ""}`;
  return props.open ? <Wizard key={key} {...props} /> : null;
}

type Override = { choice: string; other: string; confirmed: boolean };
const NO_OVERRIDE: Override = { choice: "", other: "", confirmed: false };

function Wizard({ onOpenChange, patientId, encounterId, start }: Props) {
  const toast = useToast();
  const refresh = useRefreshChart(patientId);
  const seed = start?.draft ?? start?.amend;
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<DraftItem[]>(seed ? fromPrescription(seed) : [blankItem()]);
  const [draftId, setDraftId] = useState<string | null>(start?.draft?.id ?? null);
  const [alerts, setAlerts] = useState<SafetyAlert[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const saveAndCheck = useSaveAndCheck();
  const sign = useSign();
  const cancel = useCancelPrescription();
  const allergies = useAllergies(patientId);
  const prescriptions = usePrescriptions(patientId);

  const errors = items.map(itemErrors);
  const blocking = (alerts ?? []).filter((a) => a.blocking);
  const warnings = (alerts ?? []).filter((a) => !a.blocking);
  const reasonFor = (alert: SafetyAlert) => {
    const o = overrides[alert.key];
    return o?.confirmed ? overrideReason(o.choice, o.other) : "";
  };
  const canSign = alerts !== null && blocking.every((a) => reasonFor(a) !== "");

  const update = (index: number, change: Partial<DraftItem>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const setOverride = (key: string, change: Partial<Override>) =>
    setOverrides((current) => ({
      ...current,
      [key]: { ...(current[key] ?? NO_OVERRIDE), ...change },
    }));

  async function toReview() {
    setSubmitted(true);
    setProblem(null);
    if (errors.some(hasErrors)) return;
    try {
      const { draft, alerts: found } = await saveAndCheck.mutateAsync({
        encounter: start?.draft?.encounter ?? encounterId,
        draftId,
        items,
      });
      setDraftId(draft.id);
      setAlerts(found);
      // A changed prescription may raise different alerts: earlier confirmations do not carry over.
      setOverrides((current) =>
        Object.fromEntries(Object.entries(current).filter(([k]) => found.some((a) => a.key === k))),
      );
      setStep(1);
    } catch (failure) {
      setProblem(apiError(failure).message);
    }
  }

  async function signNow() {
    if (!draftId || !alerts) return;
    setProblem(null);
    const reasons = Object.fromEntries(blocking.map((a) => [a.key, reasonFor(a)]));
    try {
      await sign.mutateAsync({ id: draftId, overrides: reasons });
    } catch (failure) {
      const body = apiError(failure);
      if (body.code === "safety_alerts") {
        // The check found something new since the preview: show it, and ask again.
        setAlerts(body.details.alerts as SafetyAlert[]);
        return setProblem("The safety check found new alerts. Review them, then sign again.");
      }
      return setProblem(body.message);
    }
    toast({ title: "Prescription signed", description: "Sent to the pharmacy.", tone: "success" });
    if (start?.amend) {
      try {
        await cancel.mutateAsync({
          id: start.amend.id,
          reason: "Replaced by an amended prescription",
        });
      } catch (failure) {
        toast({
          title: "The earlier prescription stays active",
          description: apiError(failure).message,
          tone: "error",
        });
      }
    }
    await refresh();
    onOpenChange(false);
  }

  const current = activeMedications(prescriptions.data?.results ?? []).filter(
    (m) => !start?.amend || !start.amend.items.some((i) => i.id === m.id),
  );

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      size="wide"
      title={start?.amend ? "Amended prescription" : "New prescription"}
      description={
        step === 0
          ? "Choose from the formulary. The safety check runs before you sign."
          : "Check the prescription against the patient's allergies and current medicines."
      }
      header={<Stepper steps={STEPS} current={step} />}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {step === 1 || draftId ? "Close, keep draft" : "Cancel"}
            </Button>
          }
          end={
            <>
              {step > 0 && (
                <Button variant="outline" onClick={() => setStep(0)}>
                  Previous
                </Button>
              )}
              {step === 0 ? (
                <Button type="submit" form={FORM_ID} loading={saveAndCheck.isPending}>
                  Next
                </Button>
              ) : (
                <Button
                  icon={Lock}
                  disabled={!canSign}
                  loading={sign.isPending || cancel.isPending}
                  onClick={signNow}
                >
                  Sign prescription
                </Button>
              )}
            </>
          }
        />
      }
    >
      {step === 0 && (
        <form
          id={FORM_ID}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void toReview();
          }}
          className="flex flex-col gap-4"
        >
          {problem && <Banner tone="danger" live title={problem} />}
          {start?.amend && (
            <Banner title="Amending a signed prescription">
              A signed prescription cannot be changed. This is a new prescription based on the one
              of {formatDay(start.amend.authorised_at)}; signing it cancels the earlier one.
            </Banner>
          )}
          {items.map((item, index) => (
            <ItemFields
              key={index}
              index={index}
              item={item}
              errors={submitted ? errors[index] : {}}
              removable={items.length > 1}
              onChange={(change) => update(index, change)}
              onRemove={() => setItems((all) => all.filter((_, i) => i !== index))}
            />
          ))}
          <div>
            <Button
              variant="dashed"
              icon={Plus}
              onClick={() => setItems((all) => [...all, blankItem()])}
            >
              Add another medicine
            </Button>
          </div>
        </form>
      )}

      {step === 1 && (
        <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <ul aria-label="Medicines to prescribe" className="flex flex-col gap-2">
              {items.map((item, index) => (
                <li key={index} className="rounded-control bg-surface-muted p-3">
                  <p className="text-body text-ink-900 font-semibold">{item.drugLabel}</p>
                  <p className="text-small text-ink-600">
                    {item.dose}, {humanise(item.route)}, {item.frequency}, {item.duration} days.
                    Dispense {item.quantity}.
                  </p>
                  {item.instructions && (
                    <p className="text-small text-ink-600">{item.instructions}</p>
                  )}
                </li>
              ))}
            </ul>

            {/* Alerts sit right above Sign. */}
            <section aria-label="Safety check" className="flex flex-col gap-3">
              {problem && <Banner tone="danger" live title={problem} />}
              {alerts !== null && alerts.length === 0 && (
                <p className="text-small text-ink-600 flex items-center gap-2">
                  <ShieldCheck aria-hidden size={18} weight="fill" className="text-green-600" />
                  The safety check found nothing to flag.
                </p>
              )}
              {warnings.map((alert) => (
                <Banner
                  key={alert.key}
                  tone="warning"
                  title={`${humanise(alert.kind)}: ${humanise(alert.severity)}`}
                >
                  {alert.message}
                </Banner>
              ))}
              {blocking.map((alert) => (
                <OverrideBanner
                  key={alert.key}
                  alert={alert}
                  value={overrides[alert.key] ?? NO_OVERRIDE}
                  onChange={(change) => setOverride(alert.key, change)}
                />
              ))}
              {start?.amend && (
                <p className="text-small text-ink-600">
                  Signing replaces the prescription of {formatDay(start.amend.authorised_at)}, which
                  is cancelled.
                </p>
              )}
            </section>
          </div>

          <aside aria-label="About the patient" className="flex flex-col gap-4">
            <section aria-labelledby="rx-allergies" className="flex flex-col gap-2">
              <h3 id="rx-allergies" className="text-label-caps text-ink-500 uppercase">
                Allergies
              </h3>
              {allergies.data && allergies.data.results.length > 0 ? (
                <AllergyPills allergies={allergies.data.results} />
              ) : (
                <p className="text-small text-ink-600">
                  {allergies.data ? "None recorded." : "Loading…"}
                </p>
              )}
            </section>
            <section aria-labelledby="rx-current" className="flex flex-col gap-2">
              <h3 id="rx-current" className="text-label-caps text-ink-500 uppercase">
                Current medicines
              </h3>
              {prescriptions.data ? (
                current.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {current.map((m) => (
                      <li key={m.id} className="text-small text-ink-900">
                        <span className="font-semibold">{m.drug_name}</span>
                        <span className="text-ink-600">
                          {" "}
                          · {m.dose}, {m.frequency}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-small text-ink-600">None.</p>
                )
              ) : (
                <p className="text-small text-ink-600">Loading…</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </Modal>
  );
}

function ItemFields({
  index,
  item,
  errors,
  removable,
  onChange,
  onRemove,
}: {
  index: number;
  item: DraftItem;
  errors: ReturnType<typeof itemErrors>;
  removable: boolean;
  onChange: (change: Partial<DraftItem>) => void;
  onRemove: () => void;
}) {
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 250);
  const formulary = useFormulary(term);
  // Keep the chosen drug in the list, so its label stays after the search changes.
  const options = [
    ...(item.drug ? [{ value: item.drug, label: item.drugLabel }] : []),
    ...(formulary.data ?? [])
      .filter((d) => d.id !== item.drug)
      .map((d) => ({ value: d.id!, label: drugLabel(d) })),
  ];
  const n = index + 1;

  return (
    <fieldset className="rounded-card border-line flex flex-col gap-4 border p-4">
      <legend className="text-body text-ink-900 px-1 font-semibold">Medicine {n}</legend>
      <Combobox
        label={`Medicine ${n}`}
        placeholder="Search the formulary"
        options={options}
        value={item.drug}
        onValueChange={(id) => {
          const found = options.find((o) => o.value === id);
          onChange({ drug: id, drugLabel: found?.label ?? "" });
        }}
        onQueryChange={setSearch}
        searching={formulary.isFetching}
        emptyText="Not on the formulary"
        error={errors.drug}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label={`Dose ${n}`}
          placeholder="1 tablet"
          value={item.dose}
          onChange={(e) => onChange({ dose: e.target.value })}
          error={errors.dose}
        />
        <Select
          label={`Route ${n}`}
          value={item.route}
          onValueChange={(route) => onChange({ route })}
          options={ROUTES}
        />
        <Select
          label={`Frequency ${n}`}
          value={item.frequency}
          onValueChange={(frequency) => onChange({ frequency })}
          options={FREQUENCIES}
          placeholder="Choose"
          error={errors.frequency}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={`Duration in days ${n}`}
          inputMode="numeric"
          value={item.duration}
          onChange={(e) => onChange({ duration: e.target.value })}
          error={errors.duration}
        />
        <Input
          label={`Quantity to dispense ${n}`}
          inputMode="numeric"
          value={item.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          error={errors.quantity}
        />
      </div>
      <Textarea
        label={`Instructions ${n}`}
        optional
        rows={2}
        maxLength={500}
        showCount
        value={item.instructions}
        onChange={(e) => onChange({ instructions: e.target.value })}
      />
      {removable && (
        <div>
          <Button variant="ghost" icon={Trash} onClick={onRemove}>
            Remove medicine {n}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

/** A blocking alert: the message, then the reason to override it and a confirmation. */
function OverrideBanner({
  alert,
  value,
  onChange,
}: {
  alert: SafetyAlert;
  value: Override;
  onChange: (change: Partial<Override>) => void;
}) {
  const reason = overrideReason(value.choice, value.other);
  return (
    <Banner tone="danger" live title={`${humanise(alert.kind)}: ${humanise(alert.severity)}`}>
      <p>{alert.message}</p>
      <div className="mt-3 flex flex-col gap-3">
        <Select
          label="Reason for overriding"
          value={value.choice}
          onValueChange={(choice) => onChange({ choice, confirmed: false })}
          options={OVERRIDE_REASONS}
          placeholder="Choose a reason"
        />
        {value.choice === OTHER_REASON && (
          <Textarea
            label="Your reason"
            rows={2}
            maxLength={2000}
            hint={`At least ${MIN_OVERRIDE_REASON} characters. It is recorded with your signature.`}
            value={value.other}
            onChange={(e) => onChange({ other: e.target.value, confirmed: false })}
          />
        )}
        <label className="text-body text-ink-900 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-blue-600"
            checked={value.confirmed}
            disabled={reason === ""}
            onChange={(e) => onChange({ confirmed: e.target.checked })}
          />
          I have read this alert and confirm the override
        </label>
      </div>
    </Banner>
  );
}
