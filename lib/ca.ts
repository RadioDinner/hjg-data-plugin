// CoachAccountable API client. READ-ONLY: only *.getAll / *.getTypes /
// *.getSubmissions are called. A spend() hook fires immediately before every
// wire call, so the caller (the sync job) can enforce a hard daily call cap.
// There is no path to CA that bypasses spend().

import { CA_FN } from "./config.js";
import type {
  CAAppointment,
  CAClient as CAClientEntity,
  CACoach,
  CAEngagement,
  CAInvoice,
  CAOffering,
  CAOfferingSubmission,
  CAAppointmentType,
} from "./types.js";

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

export type SpendFn = () => void; // throws (e.g. BudgetExhaustedError) to abort

type ParamValue = string | number | boolean | undefined;

function credentials(): { id: string; key: string } {
  const id = process.env.CA_API_ID;
  const key = process.env.CA_API_KEY;
  if (!id || !key) throw new CredentialsMissingError();
  return { id, key };
}

function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    // Some CA functions return an object keyed by ID; normalize to an array.
    return Object.values(payload as Record<string, T>);
  }
  return [];
}

export function hasCaCredentials(): boolean {
  return Boolean(process.env.CA_API_ID && process.env.CA_API_KEY);
}

export class CAClient {
  // spend defaults to a no-op so the client can be used without a budget guard
  // (e.g. tests); the sync job always passes a real tracker hook.
  constructor(private spend: SpendFn = () => {}) {}

  private async call<T>(fn: string, params: Record<string, ParamValue> = {}): Promise<T> {
    const { id, key } = credentials();

    this.spend(); // reserve budget BEFORE the call; throws if the cap is reached

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

    // CoachAccountable returns the payload in `return`; `result` is a status
    // word (e.g. "loaded"). Prefer `return`, falling back to `result`.
    return (json.return ?? json.result) as T;
  }

  // NOTE: pagination scheme is unconfirmed (see SPEC.md s7/s20.6). These currently
  // issue a single call. If CA paginates, add the loop HERE — it's the one place
  // that touches the wire — and remember each page must call spend() too.
  async getCoaches(includeInactive = true): Promise<CACoach[]> {
    return asArray<CACoach>(await this.call(CA_FN.coachGetAll, { includeInactive }));
  }

  async getClients(includeInactive = true, coachId?: number): Promise<CAClientEntity[]> {
    return asArray<CAClientEntity>(await this.call(CA_FN.clientGetAll, { includeInactive, CoachID: coachId }));
  }

  async getAppointments(opts: {
    dateFrom: string;
    dateTo: string;
    coachId?: number;
    clientId?: number;
    includeCanceled?: boolean;
    includePending?: boolean;
  }): Promise<CAAppointment[]> {
    return asArray<CAAppointment>(
      await this.call(CA_FN.appointmentGetAll, {
        dateFrom: opts.dateFrom,
        dateTo: opts.dateTo,
        CoachID: opts.coachId,
        ClientID: opts.clientId,
        includeCanceled: opts.includeCanceled,
        includePending: opts.includePending,
      })
    );
  }

  async getAppointmentTypes(coachId: number): Promise<CAAppointmentType[]> {
    return asArray<CAAppointmentType>(await this.call(CA_FN.appointmentGetTypes, { CoachID: coachId }));
  }

  async getOfferings(): Promise<CAOffering[]> {
    return asArray<CAOffering>(await this.call(CA_FN.offeringGetAll, {}));
  }

  async getOfferingSubmissions(
    opts: { dateFrom?: string; dateTo?: string; clientId?: number; offeringId?: number } = {}
  ): Promise<CAOfferingSubmission[]> {
    return asArray<CAOfferingSubmission>(
      await this.call(CA_FN.offeringGetSubmissions, {
        dateFrom: opts.dateFrom,
        dateTo: opts.dateTo,
        ClientID: opts.clientId,
        OfferingID: opts.offeringId,
      })
    );
  }

  // READ-ONLY: Engagement.getAll only. Called with no client/coach filter to
  // pull every engagement in one (best-effort) request; includeAppointments
  // stays false since we already mirror appointments with their EngagementID.
  async getEngagements(
    opts: { clientId?: number; coachId?: number; includeAppointments?: boolean } = {}
  ): Promise<CAEngagement[]> {
    return asArray<CAEngagement>(
      await this.call(CA_FN.engagementGetAll, {
        ClientID: opts.clientId,
        CoachID: opts.coachId,
        includeAppointments: opts.includeAppointments ?? false,
      })
    );
  }

  // READ-ONLY: Invoice.getAll only. Each invoice already carries its nested
  // paymentSet + lineItemSet, so a single call yields the billed amount, the
  // amount paid, the service date (dateOf), and the payment history. The optional
  // CoachID filter is the client's *primary* coach (per the CA docs), not
  // necessarily who ran each appointment — attribution is decided downstream.
  async getInvoices(
    opts: { dateFrom?: string; dateTo?: string; clientId?: number; coachId?: number } = {}
  ): Promise<CAInvoice[]> {
    return asArray<CAInvoice>(
      await this.call(CA_FN.invoiceGetAll, {
        dateFrom: opts.dateFrom,
        dateTo: opts.dateTo,
        ClientID: opts.clientId,
        CoachID: opts.coachId,
      })
    );
  }
}
