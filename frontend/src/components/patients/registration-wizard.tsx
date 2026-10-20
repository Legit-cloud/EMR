"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AddressBook,
  EnvelopeSimple,
  FirstAid,
  IdentificationCard,
  Phone,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/choice";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { api, apiError, ApiRequestError, fieldErrors, type Schemas, unwrap } from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { formatDate } from "@/lib/format";
import {
  ALLERGY_CATEGORIES,
  ALLERGY_SEVERITIES,
  canCheckDuplicates,
  EMPTY_ALLERGY,
  EMPTY_REGISTRATION,
  type RegistrationValues,
  registrationSchema,
  SEX_OPTIONS,
  STEP_FIELDS,
  toRegistrationBody,
} from "@/lib/patient-form";
import { useDebounced } from "@/lib/use-debounced";

export type DuplicateMatch = Schemas["DuplicateMatch"];

const STEPS = [
  { label: "Identity", icon: IdentificationCard },
  { label: "Contact", icon: AddressBook },
  { label: "Allergies", icon: FirstAid },
];

const FORM_ID = "register-patient-form";
const FIELD_FOR_API: Record<string, string> = { phone: "phone_local" };
/** The duplicate check runs while the first two steps are on screen. */
const CHECK_STEPS = 2;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the user's role may record allergies (the API enforces it). */
  canRecordAllergies: boolean;
};

/**
 * The 3-step registration wizard (docs/DESIGN.md 7.4). While the first two steps are filled
 * in it asks the API for possible duplicates; a likely match (above 85%) turns the last
 * button into "Send for review", which is also what the API does with such a registration.
 */
export function RegistrationWizard({ open, onOpenChange, canRecordAllergies }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: EMPTY_REGISTRATION,
    mode: "onTouched",
  });
  const { register, control, trigger, handleSubmit, setError, reset, formState } = form;
  const values = useWatch({ control }) as RegistrationValues;
  const allergies = useFieldArray({ control, name: "allergies" });

  const matches = useDuplicateMatches(values, open && !held && step < CHECK_STEPS);
  const found = matches.data ?? [];
  const wouldHold = found.some((m) => m.would_hold);

  const registerPatient = useMutation({
    mutationFn: async (body: Schemas["PatientRegistrationRequest"]) => {
      const { data, error, response } = await api.POST("/api/patients/patients/", { body });
      if (response.status === 409) return { held: true as const };
      if (!response.ok) throw new ApiRequestError(response.status, apiError(error));
      return { held: false as const, patient: data! };
    },
    // The wizard shows its own errors, next to the fields.
    meta: { quietErrors: true },
  });

  function close(next: boolean) {
    if (!next) {
      reset(EMPTY_REGISTRATION);
      setStep(0);
      setHeld(false);
      setFormError(null);
    }
    onOpenChange(next);
  }

  async function goNext() {
    setFormError(null);
    if (await trigger([...STEP_FIELDS[step]])) setStep(step + 1);
  }

  async function submit(data: RegistrationValues) {
    setFormError(null);
    try {
      const result = await registerPatient.mutateAsync(toRegistrationBody(data));
      if (result.held) {
        setHeld(true);
        return;
      }
      toast({
        title: "Patient registered",
        description: `${result.patient.first_name} ${result.patient.last_name}, MRN ${result.patient.mrn}`,
        tone: "success",
      });
      close(false);
      router.push(`/patients/${result.patient.id}`);
    } catch (failure) {
      const problem = apiError(failure);
      const fields = fieldErrors(problem);
      // The API names the phone "phone"; the form splits country code from number.
      const named = Object.entries(fields).map(([field, message]) => ({
        name: FIELD_FOR_API[field] ?? field,
        message,
      }));
      for (const { name, message } of named) {
        // Allergy errors are per row and shown in the banner; the rest sit by their field.
        if (name !== "allergies") setError(name as keyof RegistrationValues, { message });
      }
      const firstStep = STEP_FIELDS.findIndex((group) =>
        group.some((field) => named.some(({ name }) => name === field)),
      );
      if (firstStep >= 0) setStep(firstStep);
      setFormError(
        named.length
          ? "Some details were not accepted. Check the highlighted fields."
          : problem.message,
      );
    }
  }

  const last = step === STEPS.length - 1;
  const phoneCountry = COUNTRIES.find((c) => c.iso === values.phone_country);

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="Register a patient"
      description={
        held
          ? undefined
          : "Check the details with the patient. Possible matches appear as you type."
      }
      header={held ? undefined : <Stepper steps={STEPS} current={step} />}
      footer={
        held ? (
          <ModalFooter end={<Button onClick={() => close(false)}>Done</Button>} />
        ) : (
          <ModalFooter
            start={
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
            }
            end={
              <>
                {step > 0 && (
                  <Button variant="outline" onClick={() => setStep(step - 1)}>
                    Previous
                  </Button>
                )}
                <Button type="submit" form={FORM_ID} loading={registerPatient.isPending}>
                  {last ? (wouldHold ? "Send for review" : "Register patient") : "Next"}
                </Button>
              </>
            }
          />
        )
      }
    >
      {held ? (
        <Banner live title="Sent for review">
          This person looks like a patient who is already registered, so no new record was created.
          Front desk or a doctor will check it in Duplicate review and either link it to the
          existing record or register the patient.
        </Banner>
      ) : (
        <form
          id={FORM_ID}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            // Enter inside a step moves on; only the last step submits.
            return last ? handleSubmit(submit)(event) : goNext();
          }}
          className="flex flex-col gap-5"
        >
          {formError && <Banner tone="danger" live title={formError} />}

          {step === 0 && (
            <fieldset className="flex flex-col gap-4">
              <legend className="sr-only">Identity</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="First name"
                  autoComplete="off"
                  {...register("first_name")}
                  error={formState.errors.first_name?.message}
                />
                <Input
                  label="Last name"
                  autoComplete="off"
                  {...register("last_name")}
                  error={formState.errors.last_name?.message}
                />
              </div>
              <Input
                label="Middle name"
                optional
                autoComplete="off"
                {...register("middle_name")}
                error={formState.errors.middle_name?.message}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Date of birth"
                  type="date"
                  {...register("date_of_birth")}
                  error={formState.errors.date_of_birth?.message}
                />
                <Input
                  label="National ID"
                  optional
                  autoComplete="off"
                  {...register("national_id")}
                  error={formState.errors.national_id?.message}
                />
              </div>
              <Controller
                control={control}
                name="sex"
                render={({ field }) => (
                  <ChoiceChips
                    legend="Sex"
                    value={field.value}
                    onValueChange={field.onChange}
                    options={[...SEX_OPTIONS]}
                  />
                )}
              />
            </fieldset>
          )}

          {step === 1 && (
            <fieldset className="flex flex-col gap-4">
              <legend className="sr-only">Contact</legend>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_1fr]">
                <Controller
                  control={control}
                  name="phone_country"
                  render={({ field }) => (
                    <Select
                      label="Country code"
                      value={field.value}
                      onValueChange={field.onChange}
                      options={COUNTRIES.map((c) => ({
                        value: c.iso,
                        label: `${c.name} (+${c.dial})`,
                      }))}
                    />
                  )}
                />
                <Input
                  label="Phone"
                  optional
                  type="tel"
                  inputMode="tel"
                  icon={Phone}
                  autoComplete="off"
                  placeholder={phoneCountry?.iso === "NG" ? "0803 123 4567" : undefined}
                  hint="Start with + to enter a number from another country."
                  {...register("phone_local")}
                  error={formState.errors.phone_local?.message}
                />
              </div>
              <Input
                label="Email"
                optional
                type="email"
                icon={EnvelopeSimple}
                autoComplete="off"
                {...register("email")}
                error={formState.errors.email?.message}
              />
              <Textarea
                label="Address"
                optional
                rows={2}
                maxLength={200}
                showCount
                {...register("address_line")}
                error={formState.errors.address_line?.message}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="City"
                  optional
                  {...register("city")}
                  error={formState.errors.city?.message}
                />
                <Input
                  label="State"
                  optional
                  {...register("state")}
                  error={formState.errors.state?.message}
                />
                <Controller
                  control={control}
                  name="country"
                  render={({ field }) => (
                    <Select
                      label="Country"
                      value={field.value}
                      onValueChange={field.onChange}
                      options={COUNTRIES.map((c) => ({ value: c.iso, label: c.name }))}
                    />
                  )}
                />
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset className="flex flex-col gap-4">
              <legend className="sr-only">Allergies</legend>
              {canRecordAllergies ? (
                <>
                  <p className="text-body text-ink-600">
                    Record any known allergy. They are checked when a medicine is prescribed, and
                    you can add more later on the chart.
                  </p>
                  {allergies.fields.map((row, index) => {
                    const errors = formState.errors.allergies?.[index];
                    return (
                      <div
                        key={row.id}
                        role="group"
                        aria-label={`Allergy ${index + 1}`}
                        className="rounded-control border-line bg-surface-muted flex flex-col gap-3 border p-3"
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            label="Substance"
                            {...register(`allergies.${index}.substance`)}
                            error={errors?.substance?.message}
                          />
                          <Controller
                            control={control}
                            name={`allergies.${index}.category`}
                            render={({ field }) => (
                              <Select
                                label="Type"
                                value={field.value}
                                onValueChange={field.onChange}
                                options={[...ALLERGY_CATEGORIES]}
                              />
                            )}
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                          <Input
                            label="Reaction"
                            {...register(`allergies.${index}.reaction`)}
                            error={errors?.reaction?.message}
                          />
                          <Controller
                            control={control}
                            name={`allergies.${index}.severity`}
                            render={({ field }) => (
                              <Select
                                label="Severity"
                                value={field.value}
                                onValueChange={field.onChange}
                                options={[...ALLERGY_SEVERITIES]}
                              />
                            )}
                          />
                        </div>
                        <div>
                          <Button
                            variant="ghost"
                            icon={Trash}
                            onClick={() => allergies.remove(index)}
                            aria-label={`Remove allergy ${index + 1}`}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <div>
                    <Button
                      variant="dashed"
                      icon={Plus}
                      onClick={() => allergies.append(EMPTY_ALLERGY)}
                    >
                      Add an allergy
                    </Button>
                  </div>
                </>
              ) : (
                <Banner title="Allergies are recorded by clinical staff">
                  A doctor, nurse or pharmacist adds allergies on the patient&apos;s chart.
                </Banner>
              )}
            </fieldset>
          )}

          {step < CHECK_STEPS && <PossibleMatches matches={found} />}
        </form>
      )}
    </Modal>
  );
}

/** Looks for existing patients like the one being typed, once the identity is complete. */
function useDuplicateMatches(values: RegistrationValues, active: boolean) {
  // Debounce a string: an object would be a new value on every render and restart the timer
  // (and re-render) forever.
  const typed = JSON.stringify({
    first_name: values.first_name ?? "",
    last_name: values.last_name ?? "",
    date_of_birth: values.date_of_birth ?? "",
    national_id: values.national_id ?? "",
  });
  const settledText = useDebounced(typed, 500);
  const settled = useMemo(
    () =>
      JSON.parse(settledText) as Pick<
        RegistrationValues,
        "first_name" | "last_name" | "date_of_birth" | "national_id"
      >,
    [settledText],
  );
  return useQuery({
    queryKey: ["duplicate-check", settled],
    queryFn: () =>
      unwrap(
        api.POST("/api/patients/patients/check-duplicates/", {
          body: {
            first_name: settled.first_name.trim(),
            last_name: settled.last_name.trim(),
            date_of_birth: settled.date_of_birth,
            national_id: settled.national_id.trim(),
          },
        }),
      ),
    enabled: active && canCheckDuplicates(settled),
    staleTime: 60_000,
    retry: false,
  });
}

/** Existing patients that look like the one being typed, with their match percentage. */
export function PossibleMatches({ matches }: { matches: DuplicateMatch[] }) {
  const likely = matches.some((m) => m.would_hold);
  return (
    // The live region is always present so new matches are announced when they arrive.
    <div aria-live="polite">
      {matches.length > 0 && (
        <section aria-label="Possible matches">
          <Banner title={likely ? "This person may already be registered" : "Possible matches"}>
            <ul className="mt-2 flex flex-col gap-2">
              {matches.map((match) => (
                <li
                  key={match.patient_id}
                  className="bg-surface rounded-control text-ink-900 flex flex-col gap-1.5 p-2.5"
                >
                  <span>
                    <span className="font-semibold">
                      {match.first_name} {match.last_name}
                    </span>
                    <span className="text-small text-ink-600">
                      {" "}
                      · <span className="font-mono whitespace-nowrap">{match.mrn}</span> · born{" "}
                      <span className="whitespace-nowrap">{formatDate(match.date_of_birth)}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {match.would_hold && (
                      <StatusPill
                        status={{ label: "Likely match", tone: "amber", icon: FirstAid }}
                      />
                    )}
                    <span className="tnum text-small font-bold">
                      {Math.round(match.score * 100)}% match
                    </span>
                    <a
                      href={`/patients/${match.patient_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open existing record for ${match.first_name} ${match.last_name} (opens in a new tab)`}
                      className="text-small font-semibold text-blue-600 hover:underline"
                    >
                      Open existing record
                    </a>
                  </span>
                </li>
              ))}
            </ul>
            {likely && (
              <p className="text-small mt-2">
                Registering will send this for review instead of creating a second record.
              </p>
            )}
          </Banner>
        </section>
      )}
    </div>
  );
}
