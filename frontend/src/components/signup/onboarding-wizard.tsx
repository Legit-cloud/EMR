"use client";

import { Buildings, CheckCircle, Stethoscope, SquaresFour, Users } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LogoMark, PRODUCT_NAME } from "@/components/layout/logo";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { RadioCards } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { isNotAvailable } from "@/lib/api";
import {
  type Answers,
  BED_BANDS,
  FACILITY_TYPES,
  MODULE_LABELS,
  missingAnswers,
  type Profile,
  signupMessage,
  STAFF_BANDS,
  toE164,
  toggle,
  useFinishOnboarding,
  useOnboarding,
  useSaveAnswers,
} from "@/lib/onboarding";

const STEPS = [
  { label: "Your facility", icon: Buildings },
  { label: "Size", icon: Users },
  { label: "Departments", icon: Stethoscope },
  { label: "What you need", icon: SquaresFour },
];

/**
 * The few questions after sign-up. Each step saves as you go, so closing the tab loses nothing.
 * Finishing names the facility, creates the departments you chose and opens the dashboard.
 */
export function OnboardingWizard() {
  const router = useRouter();
  const onboarding = useOnboarding();

  // Nothing to answer: set up by hand, or already finished.
  const done =
    onboarding.data?.complete || (onboarding.isError && isNotAvailable(onboarding.error));
  useEffect(() => {
    if (done) router.replace("/dashboard");
  }, [done, router]);

  return (
    <main className="bg-surface flex min-h-dvh justify-center p-4 sm:p-8">
      <div className="flex w-full max-w-[640px] flex-col gap-6">
        <div className="flex items-center gap-2 self-center">
          <LogoMark />
          <span className="text-page-title text-ink-900">{PRODUCT_NAME}</span>
        </div>
        {onboarding.isError && !done ? (
          <Banner tone="danger" live title="Your details could not be loaded.">
            Check your connection and refresh the page.
          </Banner>
        ) : !onboarding.data || done ? (
          <p role="status" className="text-body text-ink-600 text-center">
            Loading…
          </p>
        ) : (
          <Questions profile={onboarding.data} />
        )}
      </div>
    </main>
  );
}

function Questions({ profile }: { profile: Profile }) {
  const router = useRouter();
  const toast = useToast();
  const save = useSaveAnswers();
  const finish = useFinishOnboarding();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<{
    facility_name: string;
    facility_type: string;
    city: string;
    phone: string;
    staff_band: string;
    bed_band: string;
    departments: string[];
    modules: string[];
    heard_from: string;
  }>({
    facility_name: profile.facility_name ?? "",
    facility_type: profile.facility_type ?? "",
    city: profile.city ?? "",
    phone: profile.phone ?? "",
    staff_band: profile.staff_band ?? "",
    bed_band: profile.bed_band ?? "",
    departments: profile.departments,
    modules: profile.modules,
    heard_from: profile.heard_from ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<typeof answers>) => setAnswers((a) => ({ ...a, ...patch }));

  /** What the current step sends, or the errors that stop it. */
  function stepAnswers(): { body: Answers } | { errors: Record<string, string> } {
    const found: Record<string, string> = {};
    if (step === 0) {
      if (!answers.facility_name.trim()) found.facility_name = "Enter the name of the facility.";
      if (!answers.facility_type) found.facility_type = "Choose the type of facility.";
      const phone = toE164(answers.phone);
      if (!phone) found.phone = "Enter a phone number, like 08012345678 or +2348012345678.";
      if (Object.keys(found).length > 0) return { errors: found };
      return {
        body: {
          facility_name: answers.facility_name.trim(),
          facility_type: answers.facility_type as Answers["facility_type"],
          city: answers.city.trim(),
          phone: phone!,
        },
      };
    }
    if (step === 1) {
      if (!answers.staff_band) found.staff_band = "Choose how many staff you have.";
      if (Object.keys(found).length > 0) return { errors: found };
      return {
        body: {
          staff_band: answers.staff_band as Answers["staff_band"],
          ...(answers.bed_band ? { bed_band: answers.bed_band as Answers["bed_band"] } : {}),
        },
      };
    }
    if (step === 2) {
      return { body: { departments: answers.departments as Answers["departments"] } };
    }
    return {
      body: {
        modules: answers.modules as Answers["modules"],
        heard_from: answers.heard_from.trim(),
      },
    };
  }

  async function next() {
    setProblem(null);
    const checked = stepAnswers();
    if ("errors" in checked) return setErrors(checked.errors);
    setErrors({});
    try {
      const saved = await save.mutateAsync(checked.body);
      if (step < STEPS.length - 1) return setStep(step + 1);
      const missing = missingAnswers(saved);
      if (missing.length > 0) {
        setStep(0);
        return setProblem(`We still need ${missing.join(", ")}.`);
      }
      await finish.mutateAsync();
      toast({ title: "Your organisation is ready", tone: "success" });
      router.replace("/dashboard");
    } catch (failure) {
      setProblem(signupMessage(failure));
    }
  }

  const busy = save.isPending || finish.isPending;
  const last = step === STEPS.length - 1;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-page-title text-ink-900">
          Welcome, set up {profile.organisation_name}
        </h1>
        <p className="text-body text-ink-600">
          A few questions so the system fits your organisation. You can change all of this later.
        </p>
      </div>
      <Stepper steps={STEPS} current={step} />
      <section aria-label={STEPS[step].label} className="flex flex-col gap-5">
        {problem && <Banner tone="danger" live title={problem} />}
        {step === 0 && (
          <>
            <Input
              label="Name of the facility"
              value={answers.facility_name}
              error={errors.facility_name}
              maxLength={200}
              onChange={(e) => set({ facility_name: e.target.value })}
            />
            <RadioCards
              legend="Type of facility"
              columns={2}
              options={FACILITY_TYPES.map((t) => ({ ...t }))}
              value={answers.facility_type}
              error={errors.facility_type}
              onValueChange={(value) => set({ facility_type: value })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="City"
                optional
                value={answers.city}
                maxLength={100}
                onChange={(e) => set({ city: e.target.value })}
              />
              <Input
                label="Phone number"
                inputMode="tel"
                value={answers.phone}
                error={errors.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <Select
              label="How many staff work there?"
              options={STAFF_BANDS}
              value={answers.staff_band || undefined}
              placeholder="Choose a range"
              error={errors.staff_band}
              onValueChange={(value) => set({ staff_band: value })}
            />
            <Select
              label="How many inpatient beds?"
              optional
              options={BED_BANDS}
              value={answers.bed_band || undefined}
              placeholder="Choose a range"
              onValueChange={(value) => set({ bed_band: value })}
            />
          </>
        )}
        {step === 2 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-body text-ink-900 font-semibold">
              Which departments do you run?
            </legend>
            <p className="text-small text-ink-600">We will create these for you.</p>
            {profile.department_choices.map((name) => (
              <label key={name} className="text-body text-ink-900 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={answers.departments.includes(name)}
                  onChange={() => set({ departments: toggle(answers.departments, name) })}
                />
                {name}
              </label>
            ))}
          </fieldset>
        )}
        {step === 3 && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-body text-ink-900 font-semibold">
                What do you want to use first?
              </legend>
              {profile.module_choices.map((key) => (
                <label key={key} className="text-body text-ink-900 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={answers.modules.includes(key)}
                    onChange={() => set({ modules: toggle(answers.modules, key) })}
                  />
                  {MODULE_LABELS[key] ?? key}
                </label>
              ))}
            </fieldset>
            <Input
              label="How did you hear about us?"
              optional
              value={answers.heard_from}
              maxLength={100}
              onChange={(e) => set({ heard_from: e.target.value })}
            />
          </>
        )}
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          <Button icon={last ? CheckCircle : undefined} loading={busy} onClick={next}>
            {last ? "Finish and open dashboard" : "Continue"}
          </Button>
        </div>
      </section>
    </>
  );
}
