import type { ComponentType } from "react";

import { ChartArt, DashboardArt, ScheduleArt } from "./illustrations";

export type Slide = {
  id: string;
  title: string;
  text: string;
  Art: ComponentType;
};

/** What the left side of the sign-up page says, in the order it is shown. */
export const SLIDES: Slide[] = [
  {
    id: "overview",
    title: "Run your whole facility from one place",
    text: "Patients, appointments, pharmacy, wards and billing, all connected, so nothing is typed twice.",
    Art: DashboardArt,
  },
  {
    id: "records",
    title: "Every patient's record, always at hand",
    text: "Vitals, diagnoses, prescriptions and results in one chart, with every access recorded.",
    Art: ChartArt,
  },
  {
    id: "flow",
    title: "From booking to payment, without the paperwork",
    text: "Appointments, queues and invoices flow into the ledger, so your books stay up to date.",
    Art: ScheduleArt,
  },
];
