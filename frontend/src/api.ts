import { Injectable, inject } from "@angular/core";
import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from "@angular/common/http";
export interface Rule {
  id: number;
  effective_from: string;
  effective_to: string | null;
  max_quantity_per_dispense: number;
  max_quantity_per_30_days: number;
  requires_authorisation: boolean;
}
export interface Medicine {
  code: string;
  name: string;
  form: string;
  strength_value: number;
  strength_unit: string;
  is_active: boolean;
  current_rule?: Rule | null;
}
export interface Dispense {
  id: number;
  medicine_code: string;
  patient_ref: string;
  quantity: number;
  dispensed_at: string;
}
export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}
export interface Violation {
  code: string;
  field: string;
  message: string;
}
export function violations(e: HttpErrorResponse): Violation[] {
  const values: unknown = e.error?.error?.violations;
  if (
    Array.isArray(values) &&
    values.length &&
    values.every(
      (v) =>
        v &&
        typeof v.code === "string" &&
        typeof v.field === "string" &&
        typeof v.message === "string",
    )
  )
    return values;
  return [
    {
      code: "request_failed",
      field: "",
      message:
        e.status === 0
          ? "Connection lost. Check your connection and try again."
          : `Request failed (${e.status}). Try again to confirm the outcome.`,
    },
  ];
}
@Injectable({ providedIn: "root" })
export class Api {
  private http = inject(HttpClient);
  get<T>(path: string, values: Record<string, string | null> = {}) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(values))
      if (value !== null) params = params.set(key, value);
    return this.http.get<T>("/api/v1" + path, { params });
  }
  post<T>(path: string, body: unknown) {
    return this.http.post<T>("/api/v1" + path, body);
  }
}
