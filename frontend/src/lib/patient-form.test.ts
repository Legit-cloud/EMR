import { describe, expect, it } from "vitest";

import {
  buildPhone,
  canCheckDuplicates,
  cleanName,
  contactSchema,
  EMPTY_REGISTRATION,
  identitySchema,
  isRealDate,
  registrationSchema,
  toRegistrationBody,
} from "./patient-form";

const identity = (over: Partial<typeof EMPTY_REGISTRATION> = {}) =>
  identitySchema.safeParse({ ...EMPTY_REGISTRATION, ...over });
const messages = (result: ReturnType<typeof identity>) =>
  result.success ? [] : result.error.issues.map((i) => i.message);

const VALID = { first_name: "Adaeze", last_name: "Okonkwo", date_of_birth: "1990-04-12" };

describe("names (FR: letters, spaces, hyphens, apostrophes, accents)", () => {
  it.each(["José", "O'Brien", "D’Angelo", "Anne-Marie", "Mary Ann", "Zoë", "Ọlábísí", "Ngozi"])(
    "accepts %s",
    (name) => {
      expect(identity({ ...VALID, first_name: name }).success).toBe(true);
    },
  );

  it.each(["Ada3", "Ada_Eze", "Ada@Eze", "Ada--Eze", "Ada  -Eze", "-Ada", "Ada-", "1234"])(
    "rejects %s with an explanation",
    (name) => {
      expect(messages(identity({ ...VALID, first_name: name }))).toContain(
        "Use letters only, separated by single spaces, hyphens or apostrophes.",
      );
    },
  );

  it("requires first and last names but not a middle name", () => {
    expect(messages(identity())).toEqual(
      expect.arrayContaining(["First name is required.", "Last name is required."]),
    );
    expect(identity({ ...VALID, middle_name: "" }).success).toBe(true);
    expect(messages(identity({ ...VALID, middle_name: "N0ne" }))).toHaveLength(1);
  });

  it("cleans names the way the API does", () => {
    expect(cleanName("  Anne   Marie ")).toBe("Anne Marie");
    expect(cleanName("D’Angelo")).toBe("D'Angelo");
    expect(cleanName("José")).toBe("José");
  });
});

describe("date of birth", () => {
  const dob = (value: string) => messages(identity({ ...VALID, date_of_birth: value }));

  it("accepts real past dates, leap days included", () => {
    expect(dob("1990-04-12")).toEqual([]);
    expect(dob("2000-02-29")).toEqual([]);
    expect(dob("1880-01-01")).toEqual([]);
  });

  it("explains each kind of bad date", () => {
    expect(dob("")).toEqual(["Date of birth is required."]);
    expect(dob("1990-02-30")).toEqual(["Enter a valid date."]);
    expect(dob("2999-01-01")).toEqual(["Date of birth cannot be in the future."]);
    expect(dob("1879-12-31")).toEqual(["Date of birth is too far in the past."]);
    expect(isRealDate("2001-02-29")).toBe(false);
  });
});

describe("national ID and sex", () => {
  it("is optional but only letters, numbers, spaces and hyphens", () => {
    expect(identity({ ...VALID, national_id: "" }).success).toBe(true);
    expect(identity({ ...VALID, national_id: "NIN 1234-567" }).success).toBe(true);
    expect(messages(identity({ ...VALID, national_id: "12#34" }))).toEqual([
      "Use letters and numbers only.",
    ]);
  });
});

describe("phone numbers (E.164)", () => {
  it("adds the country code to local numbers and keeps international ones", () => {
    expect(buildPhone("234", "0803 123 4567")).toBe("+2348031234567");
    expect(buildPhone("233", "(024) 123-4567")).toBe("+233241234567");
    expect(buildPhone("234", "+44 20 7946 0958")).toBe("+442079460958");
    expect(buildPhone("234", "0044 20 7946 0958")).toBe("+442079460958");
    expect(buildPhone("234", "  ")).toBe("");
  });

  const contact = (over: Record<string, string>) =>
    contactSchema.safeParse({
      phone_country: "NG",
      phone_local: "",
      email: "",
      address_line: "",
      city: "",
      state: "",
      country: "NG",
      ...over,
    });

  it("accepts a blank phone and a valid one, and rejects nonsense", () => {
    expect(contact({}).success).toBe(true);
    expect(contact({ phone_local: "0803 123 4567" }).success).toBe(true);
    const bad = contact({ phone_local: "12" });
    expect(bad.success).toBe(false);
    expect(!bad.success && bad.error.issues[0].path).toEqual(["phone_local"]);
  });

  it("checks email and address length", () => {
    expect(contact({ email: "ada@example.test" }).success).toBe(true);
    expect(contact({ email: "not-an-email" }).success).toBe(false);
    expect(contact({ address_line: "x".repeat(201) }).success).toBe(false);
    expect(contact({ address_line: "x".repeat(200) }).success).toBe(true);
  });
});

describe("allergies and the whole form", () => {
  it("needs a substance and reaction for each allergy row", () => {
    const row = { substance: "", category: "medication", reaction: "", severity: "severe" };
    const result = registrationSchema.safeParse({
      ...EMPTY_REGISTRATION,
      ...VALID,
      allergies: [row],
    });
    expect(result.success).toBe(false);
    const found = !result.success && result.error.issues.map((i) => i.message);
    expect(found).toEqual(
      expect.arrayContaining(["Name the substance.", "Describe the reaction."]),
    );
  });

  it("builds the API body: cleaned names, E.164 phone, trimmed allergies", () => {
    const body = toRegistrationBody({
      ...EMPTY_REGISTRATION,
      first_name: "  Adaeze ",
      last_name: "D’Okonkwo",
      date_of_birth: "1990-04-12",
      phone_local: "0803 123 4567",
      allergies: [
        {
          substance: " Penicillin ",
          category: "medication",
          reaction: " Hives ",
          severity: "severe",
        },
      ],
    });
    expect(body).toMatchObject({
      first_name: "Adaeze",
      last_name: "D'Okonkwo",
      phone: "+2348031234567",
      country: "NG",
      allergies: [{ substance: "Penicillin", reaction: "Hives", severity: "severe" }],
    });
  });

  it("looks for duplicates only once the identity is complete and valid", () => {
    expect(canCheckDuplicates({ first_name: "", last_name: "", date_of_birth: "" })).toBe(false);
    expect(canCheckDuplicates({ ...VALID, first_name: "Ada3" })).toBe(false);
    expect(canCheckDuplicates({ ...VALID, date_of_birth: "1990-13-40" })).toBe(false);
    expect(canCheckDuplicates(VALID)).toBe(true);
  });
});
