// CoachAccountable API client. READ-ONLY: only *.getAll / *.getTypes /
// *.getSubmissions are called. Every network call is reserved against the daily
// budget via spendOne() first, so there is no path to CA that bypasses the cap.

import { spendOne } from "./budget";
import { CA_FN } from "./config";
import type {
  CAAppointment,
  CAClient,
  CACoach,
  CAOffering,
  CAOfferingSubmission,
  CAAppointmentType,
} from "./types";

const CA_ENDPOINT = "https://www.coachaccountable.com/API/";

export class CAError extends Error {
  constructor(public caCode: number, message: string, public detail?: unknown) {
    super(message);
    this.name = "CAError";
  }
}

export class CredentialsMissingError extends Error {
  constructor() {
    super("CoachAccountable credentials are not configured");
    this.name = "CredentialsMissingError";
  }
}

type ParamValue = string | number | boolean | undefined;

function credentials(): { id: string; key: string } {
  const id = process.env.CA_API_ID;
  const key = process.env.CA_API_KEY;
  if (!id || !key) throw new CredentialsMissingError();
  return { id, key };
}

// One budgeted POST to CA. Returns the data payload (result, falling back to
// return). The exact payload key is documented inconsistently; both are handled.
async function caCall<T>(fn: string, params: Record<string, ParamValue> = {}): Promise<T> {
  const { id, key } = credentials();

  await spendOne(); // reserve budget BEFORE the call; throws if cap reached

  const body = new URLSearchParams();
  body.set("APIID", id);
  body.set("APIKey", key);
  body.set("a", fn);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    body.set(k, typeof v === "boolean" ? (v ? "true" : "false") : String(v));
  }

  let res: Response;
  try {
    res = await fetch(CA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    throw new CAError(-1, "Failed to reach CoachAccountable", String(e));
  }

  if (!res.ok) {
    throw new CAError(-1, `CoachAccountable HTTP ${res.status}`, { httpStatus: res.status });
  }

  const json = (await res.json()) as {
    error?: number;
    message?: string;
    result?: unknown;
    return?: unknown;
  };

  if (typeof json.error === "number" && json.error !== 0) {
    // Never include credentials; CA's message is safe to surface.
    throw new CAError(json.error, json.message || "CoachAccountable API error", {
      caCode: json.error,
    });
  }

  return (json.result ?? json.return) as T;
}

function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    // Some CA functions return an object keyed by ID; normalize to an array.
    return Object.values(payload as Record<string, T>);
  }
  return [];
}

// NOTE: pagination scheme is unconfirmed (see SPEC.md s7/s20.6). These currently
// issue a single call. If CA paginates, add the loop HERE — it's the one place
// that touches the wire — and remember each page costs one budget unit.
export async function getCoaches(includeInactive = true): Promise<CACoach[]> {
  return asArray<CACoach>(await caCall(CA_FN.coachGetAll, { includeInactive }));
}

export async function getClients(
  includeInactive = true,
  coachId?: number
): Promise<CAClient[]> {
  return asArray<CAClient>(
    await caCall(CA_FN.clientGetAll, { includeInactive, CoachID: coachId })
  );
}

export async function getAppointments(opts: {
  dateFrom: string;
  dateTo: string;
  coachId?: number;
  clientId?: number;
  includeCanceled?: boolean;
  includePending?: boolean;
}): Promise<CAAppointment[]> {
  return asArray<CAAppointment>(
    await caCall(CA_FN.appointmentGetAll, {
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      CoachID: opts.coachId,
      ClientID: opts.clientId,
      includeCanceled: opts.includeCanceled,
      includePending: opts.includePending,
    })
  );
}

export async function getAppointmentTypes(coachId: number): Promise<CAAppointmentType[]> {
  return asArray<CAAppointmentType>(
    await caCall(CA_FN.appointmentGetTypes, { CoachID: coachId })
  );
}

export async function getOfferings(): Promise<CAOffering[]> {
  return asArray<CAOffering>(await caCall(CA_FN.offeringGetAll, {}));
}

export async function getOfferingSubmissions(opts: {
  dateFrom?: string;
  dateTo?: string;
  clientId?: number;
  offeringId?: number;
} = {}): Promise<CAOfferingSubmission[]> {
  return asArray<CAOfferingSubmission>(
    await caCall(CA_FN.offeringGetSubmissions, {
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      ClientID: opts.clientId,
      OfferingID: opts.offeringId,
    })
  );
}
