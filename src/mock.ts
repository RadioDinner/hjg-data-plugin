import type { FunnelReport } from "./types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Demo data shaped like the real API response (uses the SPEC s4 numbers for the
// first four months) so the dashboard renders without a backend or CA account.
export function mockReport(year: number): FunnelReport {
  const z = () => Array<number>(12).fill(0);
  const discoveryPhone = z(); const discoveryZoom = z();
  const menteeMeetings = z(); const activeMentees = z(); const activeMentors = z();
  const seed = [
    { dP: 1, dZ: 2, meet: 77, mentees: 24, mentors: 4 },
    { dP: 5, dZ: 2, meet: 74, mentees: 27, mentors: 4 },
    { dP: 1, dZ: 3, meet: 79, mentees: 29, mentors: 4 },
    { dP: 1, dZ: 3, meet: 99, mentees: 32, mentors: 4 },
  ];
  seed.forEach((s, m) => {
    discoveryPhone[m] = s.dP; discoveryZoom[m] = s.dZ;
    menteeMeetings[m] = s.meet; activeMentees[m] = s.mentees; activeMentors[m] = s.mentors;
  });

  const revenueByMonth = z(); const unitsByMonth = z();
  revenueByMonth[0] = 3600; unitsByMonth[0] = 3;
  revenueByMonth[1] = 6000; unitsByMonth[1] = 5;
  revenueByMonth[2] = 2400; unitsByMonth[2] = 2;
  revenueByMonth[3] = 4800; unitsByMonth[3] = 4;

  return {
    year,
    funnel: [
      { key: "leads", label: "Discovery calls (leads)", count: 18 },
      { key: "converted", label: "Converted to mentee", count: 12, note: "Leads who later had a mentoring appointment." },
      { key: "active", label: "Active mentees", count: 32 },
      { key: "graduated", label: "Graduated", count: null, note: "Not a CoachAccountable field — define a rule to enable." },
    ],
    conversionRates: { leadsToConverted: 0.67 },
    sales: {
      totalUnits: 14,
      totalRevenue: 16800,
      unitsByMonth,
      revenueByMonth,
      byOffering: [
        { offeringId: 100, offeringName: "12-Week Mentoring Program", units: 9, revenue: 10800 },
        { offeringId: 200, offeringName: "Intro / Discovery Package", units: 5, revenue: 6000 },
      ],
    },
    metrics: {
      year, months: MONTHS, shortMonths: SHORT,
      discoveryPhone, discoveryZoom, menteeMeetings, activeMentees, activeMentors,
      meta: {
        appointmentsConsidered: 329,
        excludedClients: ["Gain Momentum Group 1", "Sept 2025 - Season 9"],
        uncategorizedAppointmentNames: [],
        unmatchedClientIds: [],
        computedAt: new Date().toISOString(),
        dateRange: { from: `${year}-01-01`, to: `${year}-12-31` },
        endMonth: 4,
      },
    },
    meta: {
      computedAt: new Date().toISOString(),
      stale: false,
      snapshotAgeSeconds: 0,
      budget: { capDaily: 30, usedToday: 6, remainingToday: 24 },
      warnings: ["graduation_undefined"],
    },
  };
}
